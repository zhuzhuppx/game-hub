import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

public class ChessProxy {
    static final int PORT = 8656;
    static final String WWW_ROOT = "/home/ppx/.qwenpaw/workspaces/D2GPcF/www";
    static final String DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
    static final String PIKAFISH_PATH = "/home/ppx/.qwenpaw/workspaces/D2GPcF/pikafish_data/pikafish";
    static final String PIKAFISH_NNUE = "/home/ppx/.qwenpaw/workspaces/D2GPcF/pikafish_data/pikafish.nnue";

    static PikafishClient pikafish;

    public static void main(String[] args) throws Exception {
        System.out.println("Starting Pikafish...");
        try {
            pikafish = new PikafishClient();
            System.out.println("Pikafish ready");
        } catch (Exception e) {
            System.err.println("Pikafish start failed: " + e.getMessage());
            e.printStackTrace();
        }

        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/api/chess-ai", new ChessAiHandler());
        server.createContext("/api/chess-pikafish", new PikafishHandler());
        server.createContext("/", new StaticHandler());
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.start();
        System.out.println("Chess AI Proxy + Game Hub running on port " + PORT);
    }

    // ==================== Pikafish UCI Client ====================

    static class PikafishClient {
        Process process;
        BufferedReader reader;
        BufferedWriter writer;
        final Object lock = new Object();
        final BlockingQueue<String> lineQueue = new LinkedBlockingQueue<>();

        PikafishClient() throws IOException {
            ProcessBuilder pb = new ProcessBuilder(PIKAFISH_PATH);
            pb.directory(new File("/home/ppx/.qwenpaw/workspaces/D2GPcF/pikafish_data"));
            pb.redirectErrorStream(false);
            process = pb.start();
            reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));

            // Background reader thread
            Thread rt = new Thread(() -> {
                try {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        lineQueue.offer(line);
                    }
                } catch (IOException e) {
                    System.err.println("Pikafish reader ended: " + e.getMessage());
                }
            });
            rt.setDaemon(true);
            rt.start();

            // UCI handshake
            sendLine("uci");
            String l = waitForOutput("uciok", 5000);
            if (l == null) throw new IOException("Pikafish did not respond uciok");

            sendLine("setoption name NNUEFile value " + PIKAFISH_NNUE);
            sendLine("isready");
            l = waitForOutput("readyok", 5000);
            if (l == null) throw new IOException("Pikafish did not respond readyok");
        }

        void sendLine(String line) throws IOException {
            synchronized (lock) {
                writer.write(line + "\n");
                writer.flush();
            }
        }

        String waitForOutput(String prefix, long timeoutMs) {
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (System.currentTimeMillis() < deadline) {
                try {
                    String line = lineQueue.poll(100, TimeUnit.MILLISECONDS);
                    if (line != null && line.startsWith(prefix)) return line;
                } catch (InterruptedException e) { Thread.currentThread().interrupt(); return null; }
            }
            return null;
        }

        String searchPosition(String fen, int depth) throws IOException {
            sendLine("position fen " + fen);
            sendLine("go depth " + depth);
            String line;
            long deadline = System.currentTimeMillis() + 60000;
            while (System.currentTimeMillis() < deadline) {
                try {
                    line = lineQueue.poll(5, TimeUnit.SECONDS);
                    if (line == null) {
                        // Timeout polling, check if process is alive
                        if (!process.isAlive()) throw new IOException("Pikafish process died");
                        continue;
                    }
                    if (line.startsWith("bestmove")) return line;
                } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
            throw new IOException("Timeout waiting for bestmove");
        }

        void restart() {
            try { process.destroyForcibly(); } catch (Exception e) {}
            try {
                Thread.sleep(1500);
                pikafish = new PikafishClient();
                System.out.println("Pikafish restarted");
            } catch (Exception e) {
                System.err.println("Pikafish restart failed: " + e.getMessage());
            }
        }
    }

    // ==================== UCI FEN Conversion ====================

    static final Map<Character, Character> OUR_TO_UCI = new HashMap<>();
    static {
        OUR_TO_UCI.put('r', 'R'); OUR_TO_UCI.put('h', 'N'); OUR_TO_UCI.put('e', 'B');
        OUR_TO_UCI.put('a', 'A'); OUR_TO_UCI.put('k', 'K'); OUR_TO_UCI.put('c', 'C'); OUR_TO_UCI.put('p', 'P');
        OUR_TO_UCI.put('R', 'r'); OUR_TO_UCI.put('H', 'n'); OUR_TO_UCI.put('E', 'b');
        OUR_TO_UCI.put('A', 'a'); OUR_TO_UCI.put('K', 'k'); OUR_TO_UCI.put('C', 'c'); OUR_TO_UCI.put('P', 'p');
    }

    static String boardToFEN(List<List<Map<String, String>>> board, String color) {
        StringBuilder sb = new StringBuilder();
        for (int r = 0; r < 10; r++) {
            int empty = 0;
            for (int c = 0; c < 9; c++) {
                Map<String, String> p = (board != null && r < board.size() && c < board.get(r).size())
                    ? board.get(r).get(c) : null;
                if (p == null) { empty++; continue; }
                String type = p.get("type");
                if (type == null || type.equals(" ")) { empty++; continue; }
                if (empty > 0) { sb.append(empty); empty = 0; }
                Character uci = OUR_TO_UCI.get(type.charAt(0));
                sb.append(uci != null ? uci : '?');
            }
            if (empty > 0) sb.append(empty);
            if (r < 9) sb.append('/');
        }
        sb.append(" ").append("r".equals(color) ? "w" : "b").append(" - - 0 1");
        return sb.toString();
    }

    // ==================== JSON Parser (minimal, manual) ====================

    static Map<String, Object> parseJSON(String json) {
        json = json.trim();
        if (json.startsWith("{")) return parseObject(json, 0).getValue();
        return null;
    }

    static class ParseResult {
        Object value;
        int pos;
        ParseResult(Object v, int p) { value = v; pos = p; }
        @SuppressWarnings("unchecked")
        Map<String, Object> getValue() { return (Map<String, Object>) value; }
        @SuppressWarnings("unchecked")
        List<Object> getArray() { return (List<Object>) value; }
    }

    static ParseResult parseValue(String s, int pos) {
        int p = skipWs(s, pos);
        char c = s.charAt(p);
        if (c == '{') return parseObject(s, p);
        if (c == '[') return parseArray(s, p);
        if (c == '"') return parseString(s, p);
        // number, true, false, null
        int end = p;
        while (end < s.length() && !Character.isWhitespace(s.charAt(end)) && ",}]".indexOf(s.charAt(end)) < 0) end++;
        String token = s.substring(p, end);
        if (token.equals("null")) return new ParseResult(null, end);
        if (token.equals("true")) return new ParseResult(true, end);
        if (token.equals("false")) return new ParseResult(false, end);
        // number
        try { return new ParseResult(Integer.parseInt(token), end); } catch (NumberFormatException e) {}
        try { return new ParseResult(Double.parseDouble(token), end); } catch (NumberFormatException e) {}
        return new ParseResult(token, end);
    }

    static ParseResult parseString(String s, int pos) {
        int end = pos + 1;
        while (end < s.length()) {
            if (s.charAt(end) == '\\') end += 2;
            else if (s.charAt(end) == '"') break;
            else end++;
        }
        String val = s.substring(pos + 1, end);
        return new ParseResult(val, end + 1);
    }

    static ParseResult parseObject(String s, int pos) {
        Map<String, Object> map = new HashMap<>();
        pos = skipWs(s, pos + 1);
        if (s.charAt(pos) == '}') return new ParseResult(map, pos + 1);
        while (true) {
            pos = skipWs(s, pos);
            if (s.charAt(pos) != '"') break;
            ParseResult key = parseString(s, pos);
            pos = skipWs(s, key.pos);
            if (pos >= s.length() || s.charAt(pos) != ':') break;
            pos = skipWs(s, pos + 1);
            ParseResult val = parseValue(s, pos);
            map.put((String) key.value, val.value);
            pos = skipWs(s, val.pos);
            if (pos >= s.length() || s.charAt(pos) == '}') { pos++; break; }
            if (s.charAt(pos) == ',') pos++;
        }
        return new ParseResult(map, pos);
    }

    static ParseResult parseArray(String s, int pos) {
        List<Object> list = new ArrayList<>();
        pos = skipWs(s, pos + 1);
        if (s.charAt(pos) == ']') return new ParseResult(list, pos + 1);
        while (true) {
            pos = skipWs(s, pos);
            ParseResult val = parseValue(s, pos);
            list.add(val.value);
            pos = skipWs(s, val.pos);
            if (pos >= s.length() || s.charAt(pos) == ']') { pos++; break; }
            if (s.charAt(pos) == ',') pos++;
        }
        return new ParseResult(list, pos);
    }

    static int skipWs(String s, int pos) {
        while (pos < s.length() && Character.isWhitespace(s.charAt(pos))) pos++;
        return pos;
    }

    // ==================== Handlers ====================

    static class PikafishHandler implements HttpHandler {
        @Override
        @SuppressWarnings("unchecked")
        public void handle(HttpExchange exc) throws IOException {
            try {
                exc.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
                exc.getResponseHeaders().add("Access-Control-Allow-Methods", "POST, OPTIONS");
                exc.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
                if ("OPTIONS".equals(exc.getRequestMethod())) { exc.sendResponseHeaders(204, -1); return; }
                if (!"POST".equals(exc.getRequestMethod())) { sendJson(exc, 405, "{\"error\":\"Method not allowed\"}"); return; }

                String body = new String(exc.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, Object> json = parseJSON(body);
                if (json == null) { sendJson(exc, 400, "{\"ok\":false,\"error\":\"Invalid JSON\"}"); return; }

                // Parse board
                List<List<Map<String, String>>> board = new ArrayList<>();
                @SuppressWarnings("unchecked")
                List<Object> boardRows = json.get("board") instanceof List ? (List<Object>) json.get("board") : null;
                if (boardRows != null) {
                    for (Object rowObj : boardRows) {
                        List<Object> row = (List<Object>) rowObj;
                        List<Map<String, String>> boardRow = new ArrayList<>();
                        for (Object cell : row) {
                            if (cell == null) { boardRow.add(null); }
                            else { boardRow.add((Map<String, String>) cell); }
                        }
                        board.add(boardRow);
                    }
                }

                String color = (String) json.getOrDefault("color", "r");
                // color might come from JS as a JSONLiteral string, already trimmed
                Object depthObj = json.get("depth");
                int depth = depthObj instanceof Number ? ((Number) depthObj).intValue() : 10;

                if (pikafish == null) {
                    sendJson(exc, 503, "{\"ok\":false,\"error\":\"Pikafish not started\"}");
                    return;
                }

                String fen = boardToFEN(board, color);

                String bestmoveLine;
                try {
                    bestmoveLine = pikafish.searchPosition(fen, depth);
                } catch (IOException e) {
                    System.err.println("Pikafish error: " + e.getMessage());
                    pikafish.restart();
                    try { bestmoveLine = pikafish.searchPosition(fen, depth); } catch (IOException e2) {
                        sendJson(exc, 500, "{\"ok\":false,\"error\":\"Pikafish failed\"}");
                        return;
                    }
                }

                Pattern pat = Pattern.compile("bestmove\\s+(\\w+)");
                Matcher m = pat.matcher(bestmoveLine);
                if (!m.find() || "(none)".equals(m.group(1))) {
                    sendJson(exc, 200, "{\"ok\":false,\"error\":\"no move\"}");
                    return;
                }
                String uci = m.group(1);
                int fc = uci.charAt(0) - 'a';
                int uciFr = uci.charAt(1) - '0';
                int tc = uci.charAt(2) - 'a';
                int uciTr = uci.charAt(3) - '0';
                // Pikafish rank 0 = bottom (our row 9), rank 9 = top (our row 0)
                int fr = 9 - uciFr;
                int tr = 9 - uciTr;

                String result = "{\"ok\":true,\"move\":{\"fr\":" + fr + ",\"fc\":" + fc + ",\"tr\":" + tr + ",\"tc\":" + tc + "}}";
                sendJson(exc, 200, result);

            } catch (Exception e) {
                e.printStackTrace();
                sendJson(exc, 500, "{\"ok\":false,\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}");
            }
        }
    }

    static class ChessAiHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exc) throws IOException {
            try {
                exc.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
                exc.getResponseHeaders().add("Access-Control-Allow-Methods", "POST, OPTIONS");
                exc.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
                if ("OPTIONS".equals(exc.getRequestMethod())) { exc.sendResponseHeaders(204, -1); return; }
                if (!"POST".equals(exc.getRequestMethod())) { sendJson(exc, 405, "{\"error\":\"Method not allowed\"}"); return; }

                String body = new String(exc.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String auth = exc.getRequestHeaders().getFirst("Authorization");
                String apiKey = (auth != null && auth.startsWith("Bearer ")) ? auth.substring(7) : null;
                if (apiKey == null || apiKey.isEmpty()) {
                    sendJson(exc, 400, "{\"error\":\"Missing API key\"}");
                    return;
                }

                URL url = new URL(DEEPSEEK_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(60000);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                }

                int status = conn.getResponseCode();
                String responseBody;
                try (InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream()) {
                    responseBody = new String(is.readAllBytes(), StandardCharsets.UTF_8);
                }
                exc.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
                byte[] resp = responseBody.getBytes(StandardCharsets.UTF_8);
                exc.sendResponseHeaders(status, resp.length);
                exc.getResponseBody().write(resp);
                exc.getResponseBody().close();

            } catch (Exception e) {
                e.printStackTrace();
                sendJson(exc, 500, "{\"error\":\"Proxy error: " + e.getMessage().replace("\"", "'") + "\"}");
            }
        }
    }

    static class StaticHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exc) throws IOException {
            String path = exc.getRequestURI().getPath();
            if (path.equals("/")) path = "/index.html";
            Path file = Paths.get(WWW_ROOT, path).normalize();
            if (!file.startsWith(Paths.get(WWW_ROOT).normalize())) { send404(exc); return; }
            if (Files.isDirectory(file)) file = file.resolve("index.html");
            if (!Files.exists(file) || Files.isDirectory(file)) { send404(exc); return; }

            String name = file.toString().toLowerCase();
            String mime = "application/octet-stream";
            if (name.endsWith(".html")) mime = "text/html; charset=utf-8";
            else if (name.endsWith(".css")) mime = "text/css; charset=utf-8";
            else if (name.endsWith(".js")) mime = "application/javascript; charset=utf-8";
            else if (name.endsWith(".png")) mime = "image/png";
            else if (name.endsWith(".jpg") || name.endsWith(".jpeg")) mime = "image/jpeg";
            else if (name.endsWith(".svg")) mime = "image/svg+xml";
            else if (name.endsWith(".ico")) mime = "image/x-icon";
            else if (name.endsWith(".json")) mime = "application/json; charset=utf-8";
            else if (name.endsWith(".txt")) mime = "text/plain; charset=utf-8";

            exc.getResponseHeaders().add("Content-Type", mime);
            exc.getResponseHeaders().add("Cache-Control", "no-cache");
            byte[] data = Files.readAllBytes(file);
            exc.sendResponseHeaders(200, data.length);
            exc.getResponseBody().write(data);
            exc.getResponseBody().close();
        }
    }

    static void sendJson(HttpExchange exc, int status, String json) throws IOException {
        exc.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        exc.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        exc.sendResponseHeaders(status, data.length);
        exc.getResponseBody().write(data);
        exc.getResponseBody().close();
    }

    static void send404(HttpExchange exc) throws IOException {
        byte[] data = "404 Not Found".getBytes(StandardCharsets.UTF_8);
        exc.sendResponseHeaders(404, data.length);
        exc.getResponseBody().write(data);
        exc.getResponseBody().close();
    }
}
