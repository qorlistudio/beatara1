require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const tmp = require('tmp');
const ffmpeg = require('fluent-ffmpeg');

const API_KEY = process.env.API_KEY || '';
const PORT = process.env.PORT || 3000;
const MAX_DURATION = Number(process.env.MAX_DURATION || 180);

if (!API_KEY) {
  console.error('Missing API_KEY in environment. Copy .env.example -> .env and set API_KEY.');
  process.exit(1);
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(morgan('tiny'));
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many requests' } });
app.use(limiter);

function requireApiKey(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization header' });
  const token = auth.substring(7).trim();
  if (!token || token !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'youtube-audio-worker' }));

app.post('/video-info', requireApiKey, (req, res) => {
  const { videoUrl } = req.body || {};
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });
  execFile('yt-dlp', ['-j', videoUrl], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: 'Failed to get info', details: stderr?.toString() || err.message });
    try {
      const meta = JSON.parse(stdout);
      res.json({ title: meta.title, duration: meta.duration, uploader: meta.uploader, viewCount: meta.view_count, uploadDate: meta.upload_date });
    } catch (e) { res.status(500).json({ error: 'Parse error' }); }
  });
});

app.post('/extract-audio', requireApiKey, (req, res) => {
  const { videoUrl, duration } = req.body || {};
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });
  const trimSeconds = Math.min(Number(duration || MAX_DURATION), MAX_DURATION);
  const tmpVideo = tmp.fileSync({ postfix: '.webm' });
  const tmpAudio = tmp.fileSync({ postfix: '.mp3' });
  const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', tmpVideo.name, videoUrl]);
  ytdlp.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: 'yt-dlp failed' });
    let ff = ffmpeg(tmpVideo.name).format('mp3');
    if (trimSeconds) ff.setDuration(trimSeconds);
    ff.save(tmpAudio.name).on('end', () => {
      res.setHeader('Content-Type', 'audio/mpeg');
      const rs = fs.createReadStream(tmpAudio.name);
      rs.on('close', () => { try { fs.unlinkSync(tmpAudio.name); fs.unlinkSync(tmpVideo.name); } catch {} });
      rs.pipe(res);
    }).on('error', e => res.status(500).json({ error: e.message }));
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
