const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const http = require('http');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;
const mongoURI = 'mongodb://54.198.221.238:27017/mydb';
const mqttURL = 'mqtt://54.198.221.238';

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('Failed to connect to MongoDB', err);
  });

const AlarmStatus = mongoose.model('AlarmStatus', new mongoose.Schema({
  alarm1: Boolean,
  alarm2: Boolean,
  laser: Boolean,
  movement: Boolean,
  timestamp: { type: Date, default: Date.now }
}));

const Logs = mongoose.model('Logs', new mongoose.Schema({
  message: String,
  timestamp: { type: Date, default: Date.now }
}));

const client = mqtt.connect(mqttURL);
client.on('connect', () => {
  console.log('Connected to MQTT broker');
  client.subscribe('device/status', function(err) {
    if (err) {
      console.error('Subscription error:', err);
    }
  });
});

client.on('message', (topic, message) => {
  const status = JSON.parse(message);
  AlarmStatus.create(status);
  logStatusChange(status);
  broadcast(JSON.stringify({ type: 'status', data: status }));
});

client.on('error', (error) => {
  console.error('Connection to MQTT broker failed:', error);
});

function publishCommand(command) {
  client.publish('device/command', JSON.stringify(command));
}

function logStatusChange(status) {
  if (status.alarm1 !== undefined) {
    Logs.create({ message: `Alarm 1 ${status.alarm1 ? 'activated' : 'deactivated'}`, timestamp: new Date().toISOString() });
  }
  if (status.alarm2 !== undefined) {
    Logs.create({ message: `Alarm 2 ${status.alarm2 ? 'activated' : 'deactivated'}`, timestamp: new Date().toISOString() });
  }
  if (status.laser !== undefined) {
    Logs.create({ message: `Laser sensor ${status.laser ? 'activated' : 'deactivated'}`, timestamp: new Date().toISOString() });
  }
  if (status.movement !== undefined) {
    Logs.create({ message: `Movement sensor ${status.movement ? 'activated' : 'deactivated'}`, timestamp: new Date().toISOString() });
  }
}

app.use(cors());
app.use(bodyParser.json());

app.post('/set_alarm', (req, res) => {
  publishCommand(req.body);
  logStatusChange(req.body);
  res.send({ message: 'Command sent', ...req.body });
});

app.get('/status', async (req, res) => {
  try {
    const status = await AlarmStatus.findOne().sort({ _id: -1 });
    if (status) {
      res.json(status);
    } else {
      res.status(404).json({ message: 'No status found' });
    }
  } catch (err) {
    console.error('Error fetching status:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/logs', async (req, res) => {
  try {
    const logs = await Logs.find().sort({ timestamp: -1 });
    if (logs.length > 0) {
      res.json(logs);
    } else {
      res.status(404).json({ message: 'No logs found' });
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).send('Internal Server Error');
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    console.log('Received:', message);
  });

  ws.on('close', () => {
    console.log('WebSocket was closed');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to WebSocket server' }));
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
}).on('error', (error) => {
  console.error('Server failed to start:', error);
});
