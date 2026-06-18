import { WebSocketServer } from 'ws';
import { performClassification } from './controllers/classify.controller.js';

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');

    ws.on('message', async (message) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === 'classify') {
          const { items } = parsed; // items: [{ id: '...', text: '...' }]
          if (!items || !Array.isArray(items)) {
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: 'Invalid payload: items must be an array' 
            }));
            return;
          }

          const texts = items.map(item => item.text);
          const predictions = await performClassification(texts);

          const results = items.map((item, index) => ({
            id: item.id,
            prediction: predictions[index]
          }));

          ws.send(JSON.stringify({
            type: 'classification_result',
            data: results
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${parsed.type}`
          }));
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
        ws.send(JSON.stringify({
          type: 'error',
          message: err.message
        }));
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });

  return wss;
};
