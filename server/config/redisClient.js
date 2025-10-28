import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();
const client = createClient({
    username: 'default',
    password: process.env.radis_password,
    socket: {
        host: process.env.radis_host,
        port: 10269
        
    },
     tls: {}
});

client.on('error', err => console.log('Redis Client Error', err));

await client.connect();

await client.set('foo', 'bar');
const result = await client.get('foo');
console.log(result)  // >>> bar

export const redis = client;