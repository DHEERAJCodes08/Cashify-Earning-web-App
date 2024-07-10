const {Client} = require('pg');

const pool = new Client({
    host: 'localhost',
    user: 'postgres',
    database: 'Earning App',
    password: 'dheerajprasad'

    

})

module.exports =  pool;