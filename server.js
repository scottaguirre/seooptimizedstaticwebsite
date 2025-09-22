// === Required Modules and Setup ===
const fs = require('fs');
require('dotenv').config();
const path = require('path');
const express = require('express');
const distDir = path.join(__dirname, 'dist');


// === Route Imports ===
const formRoute = require('./routes/formRoute');
const wpThemeRoute = require('./routes/wpThemeRoute');
const generateRoute = require('./routes/generateRoute');
const productionRoute = require('./routes/productionRoute');
const downloadZipRoute = require('./routes/downloadZipRoute'); 


const app = express();
const PORT = 3000;


// === Express Middleware ===
app.use(express.static('public'));
app.use('/dist', express.static(distDir));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


app.use('/', formRoute);     // handles routes like '/', maybe '/form'
app.use('/', wpThemeRoute);
app.use('/', generateRoute); // handles '/generate', 
app.use('/', productionRoute);// handles '/production'
app.use('/', downloadZipRoute);



app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
