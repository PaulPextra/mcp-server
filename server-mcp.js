import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

const app = express();
const PORT = 8000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Root MCP endpoint - this is what mcp-remote expects
app.post('/mcp', async (req, res) => {
  console.log('Received MCP request:', JSON.stringify(req.body, null, 2));

  const { method, params, id, jsonrpc } = req.body;

  try {
    // Handle notifications (no response needed) - notifications don't have an id
    if (id === undefined && method) {
      console.log(`Handling notification: ${method}`);
      switch (method) {
        case 'notifications/initialized':
          console.log('Client initialized');
          break;
        case 'notifications/cancelled':
          console.log('Request cancelled');
          break;
        default:
          console.log(`Unknown notification: ${method}`);
      }
      // For notifications, we must not send any response
      res.status(204).end(); // 204 No Content
      return;
    }

    // Validate that we have required fields for method calls
    if (!jsonrpc || !method || id === undefined) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request - missing required fields',
        },
      });
      return;
    }

    // Handle regular method calls (these have an id)
    switch (method) {
      case 'initialize':
        res.json({
          jsonrpc: '2.0',
          id: id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'Remote MCP Server',
              version: '0.1.0',
            },
          },
        });
        break;

      case 'tools/list':
        res.json({
          jsonrpc: '2.0',
          id: id,
          result: {
            tools: [
              {
                name: 'add',
                description: 'Return the sum of a and b',
                inputSchema: {
                  type: 'object',
                  properties: {
                    a: { type: 'number' },
                    b: { type: 'number' },
                  },
                  required: ['a', 'b'],
                },
              },
              {
                name: 'reverse',
                description: 'Return the input text reversed',
                inputSchema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                  },
                  required: ['text'],
                },
              },
              {
                  name: 'save_conversation',
                  description: 'Saves your entire LLM conversation to \
                    aiarchives.duckdns.org and returns a shareable URL. \
                    Provide the full conversation content as HTML or plain text \
                    in the conversation parameter. Use this after completing a \
                    conversation to create a permanent, shareable link.',
                  inputSchema: {
                    type: 'object',
                    properties:{
                        conversation: { type: 'string' },
                    },
                    required: [ 'conversation' ],
                },
              },
            ],
          },
        });
        break;

      case 'tools/call':
        if (!params || !params.name) {
          res.status(400).json({
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32602,
              message: 'Invalid params - missing tool name',
            },
          });
          return;
        }

        const { name, arguments: args } = params;
        let result;

        switch (name) {
          case 'add':
            if (typeof args.a !== 'number' || typeof args.b !== 'number') {
              res.status(400).json({
                jsonrpc: '2.0',
                id: id,
                error: {
                  code: -32602,
                  message: 'Invalid params - a and b must be numbers',
                },
              });
              return;
            }
            result = {
              content: [{ type: 'text', text: `Result: ${args.a + args.b}` }],
            };
            break;

          case 'reverse':
            if (typeof args.text !== 'string') {
              res.status(400).json({
                jsonrpc: '2.0',
                id: id,
                error: {
                  code: -32602,
                  message: 'Invalid params - text must be a string',
                },
              });
              return;
            }
            result = {
              content: [{ type: 'text', text: `Result: ${args.text.split('').reverse().join('')}` }],
            };
            break;

          case 'save_conversation':
            if (typeof args.conversation !== 'string') {
              res.status(400).json({
                jsonrpc: '2.0',
                id: id,
                error: {
                  code: -32602,
                  message: 'Invalid params - conversation must be a string',
                },
              });
              return;
            }
            
            try {
              // Create form data for the API request
              const formData = new FormData();
              formData.append('htmlDoc', new Blob([args.conversation], { type: 'text/plain' }));
              formData.append('model', 'Claude (MCP)');
              formData.append('skipScraping', 'true'); // Indicates this is from MCP, not extension
              
              // Make request to aiarchives API (running on same instance)
              const apiResponse = await fetch('https://ip-10-0-1-35.us-east-2.compute.internal:3000/api/conversation', {
                method: 'POST',
                body: formData,
              });
              
              if (!apiResponse.ok) {
                const errorText = await apiResponse.text();
                throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText} - ${errorText}`);
              }
              
              const apiResult = await apiResponse.json();
              result = {
                content: [{ 
                  type: 'text', 
                  text: `Conversation saved successfully! View it at: ${apiResult.url}` 
                }],
              };
            } catch (error) {
              console.error('Error saving conversation:', error);
              res.status(500).json({
                jsonrpc: '2.0',
                id: id,
                error: {
                  code: -32603,
                  message: `Failed to save conversation: ${error.message}`,
                },
              });
              return;
            }
            break;

          default:
            res.status(400).json({
              jsonrpc: '2.0',
              id: id,
              error: {
                code: -32601,
                message: `Unknown tool: ${name}`,
              },
            });
            return;
        }

        res.json({
          jsonrpc: '2.0',
          id: id,
          result: result,
        });
        break;

      default:
        res.status(400).json({
          jsonrpc: '2.0',
          id: id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code: -32603,
        message: error.message,
      },
    });
  }
});

// Health check endpoint
app.get('/mcp/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'Remote MCP Server',
    timestamp: new Date().toISOString(),
  });
});

// Handle GET requests to /mcp (for debugging)
app.get('/mcp', (req, res) => {
  res.json({
    message: 'MCP Server is running',
    note: 'Use POST requests for MCP protocol communication',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`▶ Remote MCP Server listening on http://0.0.0.0:${PORT}`);
  console.log(`▶ Health check: http://0.0.0.0:${PORT}/mcp/health`);
  console.log(`▶ MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
});
