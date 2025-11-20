// === Required Modules and Setup ===
const fs = require('fs');
require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const distDir = path.join(__dirname, 'dist');



// === Route Imports ===
const formRoute = require('./routes/formRoute');
const authRoute = require('./routes/authRoute');
const adminRoute = require('./routes/adminRoute');
const creditsRoute = require('./routes/creditsRoute');
const requireAuth = require('./middleware/requireAuth');
const generateRoute = require('./routes/generateRoute');
const productionRoute = require('./routes/productionRoute');
const downloadZipRoute = require('./routes/downloadZipRoute');
const exportWpThemeRoute = require('./routes/exportWpThemeRoute');




// Connecting to Mongo
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ Connected to MongoDB');
}).catch((err) => {
    console.error('❌ MongoDB connection error:', err);
});
  


const app = express();
const PORT = 3000;



// ===== STATIC FILES =====
app.use(express.static('public'));
app.use('/dist', express.static(distDir));


// ===== BODY PARSERS =====
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// ===== Express Session Middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI
}),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        httpOnly: true
    }
}));


// ===== AUTH UNPROTECTED ROUTES FIRST =====
app.use('/', authRoute); 
// login, signup, logout
// these must come before requireAuth middleware
  

// ===== PROTECTED ROUTES (requireAuth) =====
app.use('/', requireAuth, creditsRoute);      // /api/check-credits
app.use('/', requireAuth, adminRoute);        // /admin section
app.use('/', requireAuth, formRoute);         // /
app.use('/', requireAuth, generateRoute);     // /generate
app.use('/', requireAuth, productionRoute);   // /production
app.use('/', requireAuth, downloadZipRoute);
app.use('/', requireAuth, exportWpThemeRoute);




app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
