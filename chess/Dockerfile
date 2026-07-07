FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 libatomic1 \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/pikafish_data
WORKDIR /app
COPY pikafish pikafish.nnue /app/pikafish_data/
RUN chmod +x /app/pikafish_data/pikafish
COPY server.py ./
ENV PYTHONUNBUFFERED=1
EXPOSE 8656
CMD ["python3", "server.py"]
