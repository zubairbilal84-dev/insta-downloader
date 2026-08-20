const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection Setup
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://zubairbilal8008:zubairr09090@cluster0.nqdhsjx.mongodb.net/snapsave?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected Successfully!"))
    .catch(err => console.error("MongoDB Connection Error:", err));

// MongoDB Schema for Traffic & Downloads
const logSchema = new mongoose.Schema({
    type: { type: String, enum: ['view', 'download'], required: true },
    ip: { type: String, default: 'N/A' },
    country: { type: String, default: 'Unknown' },
    url: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
});

const Log = mongoose.model('Log', logSchema);

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// Rate Limiter
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: "Too many requests. Please wait 1 minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/download', apiLimiter);

// Track Visitor Pageviews in MongoDB
app.post('/api/track-view', async (req, res) => {
    try {
        const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'N/A';
        const country = req.headers['cf-ipcountry'] || 'Unknown';
        const userAgent = req.headers['user-agent'] || 'Unknown';

        await Log.create({
            type: 'view',
            ip: clientIp,
            country: country,
            userAgent: userAgent
        });

        res.json({ status: 'ok' });
    } catch (err) {
        console.error("View Track Error:", err);
        res.status(500).json({ error: "Failed to track view" });
    }
});

// Download API Endpoint
app.post('/api/download', async (req, res) => {
    const { url } = req.body;
    const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'N/A';
    const country = req.headers['cf-ipcountry'] || 'Unknown';

    if (!url || !url.includes('instagram.com')) {
        return res.status(400).json({ error: "Invalid Instagram URL provided." });
    }

    try {
        const options = {
            method: 'GET',
            url: 'https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert',
            params: { url: url },
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_KEY || '73643558b0mshe813269a1356d97p1bac4cjsn4ddabdbf869b',
                'x-rapidapi-host': 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com'
            }
        };

        const response = await axios.request(options);

        // Save Download Log to MongoDB
        await Log.create({
            type: 'download',
            ip: clientIp,
            country: country,
            url: url
        });

        res.json(response.data);
    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).json({ error: "Failed to download video. Please check URL or try again later." });
    }
});

// Stream Proxy
app.get('/api/stream', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send("No video URL.");
    try {
        const response = await axios({ method: 'get', url: videoUrl, responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' } });
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        response.data.pipe(res);
    } catch (err) { res.status(500).send("Stream Error"); }
});

// Direct Download Proxy
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

// Admin Analytics Endpoint (MongoDB Data Aggregation)
app.get('/api/admin/stats', async (req, res) => {
    try {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const startOfYesterday = new Date(startOfToday);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);

        const startOfWeek = new Date(startOfToday);
        startOfWeek.setDate(startOfWeek.getDate() - 7);

        const startOfMonth = new Date(startOfToday);
        startOfMonth.setDate(startOfMonth.getDate() - 30);

        const [
            todayViews, todayDl,
            yesterdayViews, yesterdayDl,
            weeklyViews, weeklyDl,
            monthlyViews, monthlyDl,
            trafficLogs, downloadLogs
        ] = await Promise.all([
            Log.countDocuments({ type: 'view', timestamp: { $gte: startOfToday } }),
            Log.countDocuments({ type: 'download', timestamp: { $gte: startOfToday } }),

            Log.countDocuments({ type: 'view', timestamp: { $gte: startOfYesterday, $lt: startOfToday } }),
            Log.countDocuments({ type: 'download', timestamp: { $gte: startOfYesterday, $lt: startOfToday } }),

            Log.countDocuments({ type: 'view', timestamp: { $gte: startOfWeek } }),
            Log.countDocuments({ type: 'download', timestamp: { $gte: startOfWeek } }),

            Log.countDocuments({ type: 'view', timestamp: { $gte: startOfMonth } }),
            Log.countDocuments({ type: 'download', timestamp: { $gte: startOfMonth } }),

            Log.find({ type: 'view' }).sort({ timestamp: -1 }).limit(1000),
            Log.find({ type: 'download' }).sort({ timestamp: -1 }).limit(1000)
        ]);

        res.json({
            stats: {
                today: { views: todayViews, downloads: todayDl },
                yesterday: { views: yesterdayViews, downloads: yesterdayDl },
                weekly: { views: weeklyViews, downloads: weeklyDl },
                monthly: { views: monthlyViews, downloads: monthlyDl }
            },
            traffic: trafficLogs,
            downloads: downloadLogs
        });
    } catch (err) {
        console.error("Admin Stats Error:", err);
        res.status(500).json({ error: "Failed to fetch admin stats" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});