import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import dotenv from 'dotenv';
import { UserDbService } from './src/user-db-service';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ms-client-principal');
  next();
});

app.get('/api/me/access-token', async (req, res): Promise<void> => {
  try {
    const principalHeader = req.headers['x-ms-client-principal'] as string;
    let userInfo: { userId?: string } | undefined;
    try {
      const token = Buffer.from(principalHeader ?? '', 'base64').toString('ascii');
      userInfo = (token && JSON.parse(token)) || undefined;
    } catch {
      userInfo = undefined;
    }

    if (!userInfo?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const hash = createHash('sha256').update(userInfo.userId).digest('base64');
    const db = await UserDbService.getInstance();
    let user = await db.getUserByHash(hash);
    if (!user) {
      user = await db.createUser(hash, randomUUID());
    }
    res.json({ accessToken: user.accessToken });
  } catch (error) {
    console.error('Error in access-token handler', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 7072;
app.listen(PORT, () => console.log(`Registration API listening on port ${PORT}`));
