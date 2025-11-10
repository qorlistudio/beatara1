FROM node:20-slim
RUN apt-get update && apt-get install -y ffmpeg wget ca-certificates && rm -rf /var/lib/apt/lists/*
RUN wget -O /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
