const express = require('express');
const app = express();
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { connectDB, Users, Files } = require('./config');

// ===============================
// Middleware Configuration
// ===============================

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Configure basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));
app.use('/uploads', express.static('uploads'));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage });

// Connect to database
connectDB();

// ===============================
// Authentication Routes
// ===============================

// Render signup and login pages
app.get('/signup', (req, res) => {
    res.render('signup', { error: null });
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Handle user signup
app.post("/signup", async (req, res) => {
    try {
        const { username, email, password, isAdmin } = req.body;

        // Input validation
        if (!username || !email || !password) {
            return res.render('signup', { error: 'All fields are required' });
        }

        // Check existing user
        const existingUser = await Users.findOne({
            $or: [{ username }, { email }]
        });

        if (existingUser) {
            return res.render('signup', { error: 'Username or email already exists' });
        }

        // Create new user
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new Users({
            username,
            email,
            password: hashedPassword,
            isAdmin: isAdmin === 'on' // Convert checkbox value to boolean
        });

        await newUser.save();

        // Set session
        req.session.user = {
            _id: newUser._id,
            username: newUser.username,
            email: newUser.email,
            isAdmin: newUser.isAdmin
        };

        res.redirect('/');
    } catch (error) {
        console.error("Signup error:", error);
        res.render('signup', { error: 'Error creating account' });
    }
});

// Handle user login
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await Users.findOne({ username });
        
        if (!user) {
            return res.render('login', { error: 'User not found' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.render('login', { error: 'Invalid password' });
        }

        req.session.user = {
            _id: user._id,
            username: user.username,
            email: user.email,
            isAdmin: user.isAdmin,
            profilePicture: user.profilePicture,
            collection: user.savedPapers
        };

        res.redirect('/');
    } catch (error) {
        console.error("Login error:", error);
        res.render('login', { error: 'Error logging in' });
    }
});

// Handle user logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ===============================
// Main Application Routes
// ===============================

// Render home page
app.get('/', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('home', { 
        user: req.session.user,
        message: req.session.message
    });
});

// Handle profile picture upload
app.post('/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await Users.findOne({ username: req.session.user.username });
        
        // Remove old profile picture if exists
        if (user.profilePicture?.path) {
            try {
                fs.unlinkSync(user.profilePicture.path);
            } catch (err) {
                console.error('Error deleting old profile picture:', err);
            }
        }

        const profileUrl = `/uploads/${req.file.filename}`;
        user.profilePicture = {
            filename: req.file.filename,
            path: req.file.path,
            url: profileUrl
        };
        await user.save();

        // Update session
        req.session.user.profilePicture = user.profilePicture;

        res.json({ success: true, path: profileUrl });
    } catch (error) {
        console.error('Profile picture upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Handle paper upload
app.post('/upload-paper', upload.single('paper'), async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await Users.findOne({ username: req.session.user.username });
        
        const newFile = new Files({
            title: req.body.title,
            filename: req.file.filename,
            path: req.file.path,
            fileType: req.file.mimetype,
            size: req.file.size,
            educationLevel: req.body.educationLevel,
            institution: req.body.institution,
            subject: req.body.subject,
            year: req.body.year,
            uploadedBy: user._id
        });

        await newFile.save();
        res.json({ success: true, file: newFile });
    } catch (error) {
        console.error('Paper upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Handle paper download
app.get('/api/download/:fileId', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const file = await Files.findById(req.params.fileId);
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = path.join(__dirname, '..', file.path);
        if (fs.existsSync(filePath)) {
            res.download(filePath, file.filename);
        } else {
            res.status(404).json({ error: 'File not found on server' });
        }
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Handle paper deletion
app.delete('/api/papers/:fileId', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        if (!req.session.user.isAdmin) {
            return res.status(403).json({ error: 'Not authorized to delete this file' });
        }

        const file = await Files.findById(req.params.fileId);
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = path.join(process.cwd(), file.path);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await Files.findByIdAndDelete(req.params.fileId);

        // Remove the file from all users' collections
        await Users.updateMany(
            { savedPapers: req.params.fileId },
            { $pull: { savedPapers: req.params.fileId } }
        );

        res.json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// Checking if the current user is an admin
app.get('/api/user/isAdmin', (req, res) => {
    if (req.session.user && req.session.user.isAdmin) {
        res.json({ isAdmin: true });
    } else {
        res.json({ isAdmin: false });
    }
});

// ===============================
// API Routes
// ===============================

// Get all papers
app.get('/api/papers', async (req, res) => {
    try {
        const papers = await Files.find()
            .populate({
                path: 'uploadedBy',
                select: 'username profilePicture _id'
            })
            .sort({ uploadDate: -1 });
        
        // Check if the paper is in the user's collection and if the user is the uploader
        if (req.session.user) {
            const user = await Users.findOne({ username: req.session.user.username });
            papers.forEach(paper => {
                paper = paper.toObject();
                paper.inCollection = user.savedPapers.includes(paper._id);
                paper.isUploader = paper.uploadedBy._id.toString() === user._id.toString();
            });
        }
        
        res.json(papers);
    } catch (error) {
        console.error('Error fetching papers:', error);
        res.status(500).json({ error: 'Failed to fetch papers' });
    }
});

// Get user's collection
app.get('/api/collection', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await Users.findOne({ username: req.session.user.username })
            .populate({
                path: 'savedPapers',
                populate: {
                    path: 'uploadedBy',
                    select: 'username profilePicture'
                }
            });
        res.json(user.savedPapers);
    } catch (error) {
        console.error('Error fetching collection:', error);
        res.status(500).json({ error: 'Failed to fetch collection' });
    }
});

// Add paper to collection
app.post('/api/collection/add/:fileId', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await Users.findOne({ username: req.session.user.username });
        if (!user.savedPapers.includes(req.params.fileId)) {
            user.savedPapers.push(req.params.fileId);
            await user.save();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding to collection:', error);
        res.status(500).json({ error: 'Failed to add to collection' });
    }
});

// Remove paper from collection
app.post('/api/collection/remove/:fileId', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await Users.findOne({ username: req.session.user.username });
        user.savedPapers = user.savedPapers.filter(id => id.toString() !== req.params.fileId);
        await user.save();
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing from collection:', error);
        res.status(500).json({ error: 'Failed to remove from collection' });
    }
});

// ===============================
// Server Initialization
// ===============================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});