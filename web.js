const express = require('express');
const app = express();
const port = process.env.PORT || 8004;
require('dotenv').config();

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use('/script',express.static(__dirname + "/script"));
app.use('/views',express.static(__dirname + "/views"));
app.use('/resource',express.static(__dirname + "/resource"));

app.get('/', (req, res) => {
    res.render('main', { title: 'phaser3 test'
                    , data : 'data'                 
                });
});

app.get('/adventure', (req, res) => {
    res.render('adventure', { title: 'crossfit adventure'
                    , data : 'data'                 
                });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});