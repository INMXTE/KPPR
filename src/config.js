const mongoose = require("mongoose");

// Create file schema
const FileSchema = new mongoose.Schema({
    title: String,
    filename: String,
    path: String,
    fileType: String,
    size: Number,
    uploadDate: { type: Date, default: Date.now },
    educationLevel: String,
    institution: String,
    subject: String,
    year: Number,
    uploadedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'users',
        required: true 
    }
});

const LoginSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    profilePicture: {
        filename: String,
        path: String,
        url: String // Added for easy frontend access
    },
    savedPapers: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'files',
        default: [] 
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect("mongodb://localhost:27017/KPPR-database");
        console.log("Database connection successful");
    } catch (error) {
        console.error("Database connection failed:", error);
        process.exit(1);
    }
};


// Create models
const Users = mongoose.model("users", LoginSchema);
const Files = mongoose.model("files", FileSchema);

// Export the models and connection function
module.exports = { 
    connectDB, 
    Users,
    Files
}; 