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
const wpThemeRoute = require('./routes/wpThemeRoute');
const requireAuth = require('./middleware/requireAuth');
const generateRoute = require('./routes/generateRoute');
const productionRoute = require('./routes/productionRoute');
const downloadZipRoute = require('./routes/downloadZipRoute'); 




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



// === Express Middleware ===
app.use(express.static('public'));
app.use('/dist', express.static(distDir));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// Express Session Middleware
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
  

app.use('/', authRoute);
app.use('/', adminRoute);
app.use('/', requireAuth, formRoute);     // handles routes like '/', maybe '/form'
app.use('/', requireAuth, wpThemeRoute);
app.use('/', requireAuth, generateRoute); // handles '/generate', 
app.use('/', requireAuth, productionRoute);// handles '/production'
app.use('/', requireAuth, downloadZipRoute);



app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
