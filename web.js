const express = require('express');
const app = express();
const port = process.env.PORT || 8005;
require('dotenv').config();

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use('/script',express.static(__dirname + "/script"));
app.use('/views',express.static(__dirname + "/views"));
app.use('/image',express.static(__dirname + "/image"));

app.get('/', (req, res) => {
    res.render('main', { title: 'phaser3 test'
                    , data : 'data'                 
                });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});