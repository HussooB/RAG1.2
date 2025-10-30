import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redis = createClient({
  username: 'default',
  password: process.env.radis_password,
  socket: {
    host: process.env.radis_host,
    port: 13333
  },
  tls: {}
});

redis.on('error', (err) => console.log('Redis Client Error', err));

async function clear() {
  await redis.connect();
  await redis.flushAll(); // ⚠️ clears all keys
  console.log('✅ Redis fully cleared!');
  await redis.disconnect();
}

clear();
