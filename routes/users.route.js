const express = require('express');
const router = express.Router();
const user = require('../controllers/users.controller');

router.get('/', function(req, res){
    user.list(req,res); 
});

router.post('/add', function(req, res) {
    user.create(req,res);
});

module.exports = router;