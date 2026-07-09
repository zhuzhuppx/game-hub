FROM nvidia/cuda:12.6.3-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple faster-whisper flask edge-tts

WORKDIR /app
COPY speech.py .

EXPOSE 8766
CMD ["python3", "speech.py"]
