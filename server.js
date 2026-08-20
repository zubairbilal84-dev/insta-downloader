const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudflare Turnstile Secret Key
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "0x4AAAAAAEV0wnpzgdkYY-FeLUodcdUXnWY";

// In-Memory Database for Stats and Logs
const db = {
    trafficLogs: [],  // Stores: { timestamp, ip, userAgent }
    downloadLogs: []  // Stores: { timestamp, ip, url }
};

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// Rate Limiter: Max 10 download requests per minute per IP
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: "Too many requests. Please wait 1 minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/download', apiLimiter);

// Track Visitor Pageviews
app.post('/api/track-view', (req, res) => {
    const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    db.trafficLogs.push({
        timestamp: Date.now(),
        ip: clientIp,
        userAgent: userAgent
    });

    if(db.trafficLogs.length > 5000) db.trafficLogs.shift();
    res.json({ status: 'ok' });
});

// Download API Endpoint
app.post('/api/download', async (req, res) => {
    const { url } = req.body;
    const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!url || !url.includes('instagram.com')) {
        return res.status(400).json({ error: "Invalid Instagram URL provided." });
    }

    try {
        const options = {
            method: 'GET',
            url: 'https://fast-instagram-downloader.p.rapidapi.com/get-info',
            params: { url: url },
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_KEY || 'YOUR_RAPIDAPI_KEY',
                'x-rapidapi-host': 'fast-instagram-downloader.p.rapidapi.com'
            }
        };

        const response = await axios.request(options);
        
        db.downloadLogs.push({
            timestamp: Date.now(),
            ip: clientIp,
            url: url
        });
        if(db.downloadLogs.length > 5000) db.downloadLogs.shift();

        res.json(response.data);
    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).json({ error: "Failed to download video. Please check URL or try again later." });
    }
});

// Stream & Direct Download Proxy
app.get('/api/stream', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send("No video URL.");
    try {
        const response = await axios({ method: 'get', url: videoUrl, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' } });
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        response.data.pipe(res);
    } catch (err) { res.status(500).send("Stream Error"); }
});

app.get('/api/proxy-download', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send("No video URL.");
    try {
        const response = await axios({ method: 'get', url: videoUrl, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' } });
        res.setHeader('Content-Disposition', 'attachment; filename="Instagram_Video.mp4"');
        res.setHeader('Content-Type', 'video/mp4');
        response.data.pipe(res);
    } catch (err) { res.status(500).send("Download Error"); }
});

// Admin Analytics Endpoint
app.get('/api/admin/stats', (req, res) => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    const startOfToday = new Date().setHours(0,0,0,0);
    const startOfYesterday = startOfToday - oneDay;
    const startOfWeek = now - (7 * oneDay);
    const startOfMonth = now - (30 * oneDay);

    const getStatsInRange = (startTime, endTime) => {
        const views = db.trafficLogs.filter(l => l.timestamp >= startTime && (!endTime || l.timestamp < endTime)).length;
        const downloads = db.downloadLogs.filter(l => l.timestamp >= startTime && (!endTime || l.timestamp < endTime)).length;
        return { views, downloads };
    };

    res.json({
        stats: {
            today: getStatsInRange(startOfToday),
            yesterday: getStatsInRange(startOfYesterday, startOfToday),
            weekly: getStatsInRange(startOfWeek),
            monthly: getStatsInRange(startOfMonth)
        },
        downloads: db.downloadLogs.slice(-20).reverse(),
        traffic: db.trafficLogs.slice(-20).reverse()
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});