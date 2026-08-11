import path from 'node:path';
import express from 'express';
import dotenv from 'dotenv';
import { DbService } from './src/db-service';
import { BlobService } from './src/blob-service';
import { OrderStatus, type OrderItem } from './src/order';
import { ToppingCategory } from './src/topping';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Status
app.get('/api', async (_req, res) => {
  const db = await DbService.getInstance();
  const orders = await db.getOrders();
  const registeredUsers = await db.getRegisteredUsers();
  const activeOrders = orders.filter(
    (o) => o.status !== OrderStatus.Completed && o.status !== OrderStatus.Cancelled,
  );
  res.json({ status: 'up', activeOrders: activeOrders.length, totalOrders: orders.length, registeredUsers, timestamp: new Date().toISOString() });
});

// Images
app.get('/api/images/:filepath(*)', async (req, res): Promise<void> => {
  const blobService = await BlobService.getInstance();
  const imageData = await blobService.getBlob(req.params.filepath);
  if (!imageData) { res.status(404).json({ error: 'Image not found' }); return; }
  res.setHeader('Content-Type', blobService.getContentType(req.params.filepath));
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(imageData);
});

// Pizzas
app.get('/api/pizzas', async (req, res): Promise<void> => {
  const db = await DbService.getInstance();
  const pizzas = await db.getPizzas();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json(pizzas.map((p) => ({ ...p, imageUrl: `${baseUrl}/api/images/${p.imageUrl}` })));
});

app.get('/api/pizzas/:id', async (req, res): Promise<void> => {
  const db = await DbService.getInstance();
  const pizza = await db.getPizza(req.params.id);
  if (!pizza) { res.status(404).json({ error: 'Pizza not found' }); return; }
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({ ...pizza, imageUrl: `${baseUrl}/api/images/${pizza.imageUrl}` });
});

// Toppings
app.get('/api/toppings/categories', async (_req, res): Promise<void> => {
  res.json(Object.values(ToppingCategory));
});

app.get('/api/toppings', async (req, res): Promise<void> => {
  const db = await DbService.getInstance();
  const category = req.query.category as string;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const toppings = category && Object.values(ToppingCategory).includes(category as ToppingCategory)
    ? await db.getToppingsByCategory(category as ToppingCategory)
    : await db.getToppings();
  res.json(toppings.map((t) => ({ ...t, imageUrl: `${baseUrl}/api/images/${t.imageUrl}` })));
});

app.get('/api/toppings/:id', async (req, res): Promise<void> => {
  const db = await DbService.getInstance();
  const topping = await db.getTopping(req.params.id);
  if (!topping) { res.status(404).json({ error: 'Topping not found' }); return; }
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({ ...topping, imageUrl: `${baseUrl}/api/images/${topping.imageUrl}` });
});

// Orders
app.get('/api/orders', async (req, res): Promise<void> => {
  const db = await DbService.getInstance();
  const userId = req.query.userId as string | undefined;
  const statusParam = req.query.status as string | undefined;
  const lastParam = req.query.last as string | undefined;
  const statuses = statusParam ? statusParam.split(',').map((s) => s.trim().toLowerCase()) : undefined;
  let lastMs: number | undefined;
  if (lastParam) {
    const match = lastParam.match(/^(\d+)([mh])$/i);
    if (match) lastMs = parseInt(match[1]) * (match[2].toLowerCase() === 'm' ? 60000 : 3600000);
  }
  res.json(await db.getOrders({ userId, statuses, lastMs }));
});

app.get('/api/orders/:id', async (req, res): Promise<void> => {
  const db = await DbService.getInstance();
  const order = await db.getOrder(req.params.id);
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  res.json(order);
});

app.post('/api/orders', async (req, res): Promise<void> => {
  const db = await DbService.getInstance();
  const { userId, nickname, items } = req.body as { userId: string; nickname?: string; items: { pizzaId: string; quantity: number; extraToppingIds?: string[] }[] };
  if (!userId) { res.status(400).json({ error: 'userId is required' }); return; }
  if (!(await db.userExists(userId))) {
    const registrationUrl = process.env.REGISTRATION_WEBAPP_URL ?? '<unspecified>';
    res.status(401).json({ error: `The specified userId is not registered. Please register at: ${registrationUrl}` });
    return;
  }
  if (!items || !Array.isArray(items) || items.length === 0) { res.status(400).json({ error: 'Order must contain at least one pizza' }); return; }
  const totalPizzaCount = items.reduce((sum, i) => sum + i.quantity, 0);
  if (totalPizzaCount > 50) { res.status(400).json({ error: 'Order cannot exceed 50 pizzas in total' }); return; }
  const activeOrders = await db.getOrders({ userId, statuses: [OrderStatus.Pending, OrderStatus.InPreparation] });
  if (activeOrders.length >= 5) { res.status(429).json({ error: 'Too many active orders: limit is 5 per user' }); return; }

  const orderItems: OrderItem[] = [];
  let totalPrice = 0;
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) { res.status(400).json({ error: `Quantity for pizzaId ${item.pizzaId} must be a positive integer` }); return; }
    const pizza = await db.getPizza(item.pizzaId);
    if (!pizza) { res.status(400).json({ error: `Pizza with ID ${item.pizzaId} not found` }); return; }
    let extraToppingsPrice = 0;
    if (item.extraToppingIds?.length) {
      for (const tid of item.extraToppingIds) {
        const topping = await db.getTopping(tid);
        if (!topping) { res.status(400).json({ error: `Topping with ID ${tid} not found` }); return; }
        extraToppingsPrice += topping.price;
      }
    }
    totalPrice += (pizza.price + extraToppingsPrice) * item.quantity;
    orderItems.push({ pizzaId: item.pizzaId, quantity: item.quantity, extraToppingIds: item.extraToppingIds });
  }

  const now = new Date();
  const pizzaCount = orderItems.reduce((sum, i) => sum + i.quantity, 0);
  const minMinutes = 3 + Math.max(0, pizzaCount - 2);
  const maxMinutes = 5 + Math.max(0, pizzaCount - 2);
  const estimatedMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
  const order = await db.createOrder({
    userId, nickname, createdAt: now.toISOString(),
    items: orderItems,
    estimatedCompletionAt: new Date(now.getTime() + estimatedMinutes * 60000).toISOString(),
    totalPrice, status: OrderStatus.Pending, completedAt: undefined,
  });
  res.status(201).json(order);
});

app.delete('/api/orders/:id', async (req, res): Promise<void> => {
  const db = await DbService.getInstance();
  const { id } = req.params;
  const userId = req.query.userId as string;
  if (!userId) { res.status(400).json({ error: 'userId is required as a query parameter' }); return; }
  const order = await db.getOrder(id, true);
  if (order && order.userId !== userId) { res.status(403).json({ error: 'You are not authorized to cancel this order' }); return; }
  const cancelled = await db.cancelOrder(id);
  if (!cancelled) { res.status(404).json({ error: 'Order not found or cannot be cancelled' }); return; }
  res.json(cancelled);
});

// Order status timer (runs every 40s)
setInterval(async () => {
  const db = await DbService.getInstance();
  const now = new Date();
  const orders = await db.getOrders({ statuses: [OrderStatus.Pending, OrderStatus.InPreparation, OrderStatus.Ready] });
  for (const order of orders) {
    if (order.status === OrderStatus.Pending) {
      const mins = (now.getTime() - new Date(order.createdAt).getTime()) / 60000;
      if (mins > 3 || (mins >= 1 && Math.random() < 0.5))
        await db.updateOrder(order.id, { status: OrderStatus.InPreparation });
    } else if (order.status === OrderStatus.InPreparation) {
      const diff = (now.getTime() - new Date(order.estimatedCompletionAt).getTime()) / 60000;
      if (diff > 3 || (Math.abs(diff) <= 3 && Math.random() < 0.5))
        await db.updateOrder(order.id, { status: OrderStatus.Ready, readyAt: now.toISOString() });
    } else if (order.status === OrderStatus.Ready && order.readyAt) {
      const mins = (now.getTime() - new Date(order.readyAt).getTime()) / 60000;
      if (mins >= 1 && (mins > 2 || Math.random() < 0.5))
        await db.updateOrder(order.id, { status: OrderStatus.Completed, completedAt: now.toISOString() });
    }
  }
}, 40000);

const PORT = process.env.PORT || 7071;
app.listen(PORT, () => console.log(`Pizza API listening on port ${PORT}`));
