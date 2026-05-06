const path = require('path');
const express = require('express');
const apiRouter = require('./routes/api');
const smsRouter = require('./routes/sms');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);
app.use('/api', smsRouter);

app.get('/technicians/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'technician.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SkillCat demo running on http://localhost:${PORT}`);
});
