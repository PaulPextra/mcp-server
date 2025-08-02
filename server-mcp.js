import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import FormData from 'form-data';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const SERVER_BASE_URL = 'http://10.0.1.35:3000';

if (!SERVER_BASE_URL) {
  console.error('BASE_URL is not set in environment variables.');
  process.exit(1);
}

app.use(cors());
app.use(bodyParser.json());

app.post('/mcp', async (req, res) => {
  console.log('Received MCP request:', JSON.stringify(req.body, null, 2));

  const { method, params, id, jsonrpc } = req.body;

  try {
    // Handle notifications (no response)
    if (id === undefined && method) {
      console.log(`Notification received: ${method}`);
      return res.status(204).end();
    }

    // Validate JSON-RPC
    if (!jsonrpc || !method || id === undefined) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32600, message: 'Invalid Request - missing required fields' },
      });
    }

    switch (method) {
      case 'initialize':
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'Remote MCP Server', version: '1.0.0' },
          },
        });

      case 'tools/list':
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'save_conversation',
                description:
                  'Saves entire LLM conversation to aiarchives.duckdns.org and returns a shareable URL. Provide full conversation text.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    conversation: { type: 'string', description: 'Full conversation as text or HTML' },
                  },
                  required: ['conversation'],
                },
              },
            ],
          },
        });

      case 'tools/call':
        if (!params || !params.name || !params.arguments) {
          return res.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params - missing tool name or arguments' },
          });
        }

        const toolName = params.name;
        const toolArgs = params.arguments;

        const TOOLS = {
          save_conversation: async (args) => {
            if (!args.conversation || typeof args.conversation !== 'string') {
              throw new Error('`conversation` must be a string');
            }

            const formData = new FormData();
            formData.append('htmlDoc', Buffer.from(args.conversation, 'utf-8'), {
              filename: 'conversation.txt',
              contentType: 'text/plain',
            });
            formData.append('model', 'Claude (MCP)');
            formData.append('skipScraping', '');

            const response = await fetch(`http://10.0.1.35:3000/api/conversation`, {
              method: 'POST',
              body: formData,
            });

            if (response.status === 201) {
              const data = await response.json();
              return `Conversation saved successfully! View it at: ${data.url || 'N/A'}`;
            } else {
              const errorText = await response.text();
              throw new Error(`API request failed: ${response.status} - ${errorText}`);
            }
          },
        };

        try {
          if (!TOOLS[toolName]) {
            throw new Error(`Unknown tool: ${toolName}`);
          }

          const resultText = await TOOLS[toolName](toolArgs);
          return res.json({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: resultText }] },
          });
        } catch (err) {
          return res.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: err.message },
          });
        }

      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32603, message: error.message },
    });
  }
});

// Health check
app.get('/mcp/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'Remote MCP Server',
    timestamp: new Date().toISOString(),
  });
});

// Debug route
app.get('/mcp', (req, res) => {
  res.json({
    message: 'MCP Server is running',
    note: 'Use POST requests for MCP protocol communication',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`▶ MCP Server listening on http://0.0.0.0:${PORT}`);
  console.log(`▶ Health check: http://0.0.0.0:${PORT}/mcp/health`);
  console.log(`▶ MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
});
