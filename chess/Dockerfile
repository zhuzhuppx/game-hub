FROM debian:bookworm-slim

# Install Node.js 22 + libatomic1 (pikafish dependency)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libatomic1 \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/pikafish_data
WORKDIR /app
COPY pikafish pikafish.nnue /app/pikafish_data/
RUN chmod +x /app/pikafish_data/pikafish
COPY server.js ./
EXPOSE 8656
CMD ["node", "server.js"]
