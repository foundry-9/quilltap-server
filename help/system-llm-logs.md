# LLM Logs

> **[Open this page in Quilltap](/foundry)**

The LLM Logs tool shows detailed records of all AI model interactions and API calls in your Quilltap system.

## What Are LLM Logs?

LLM Logs record every interaction with Large Language Models (AI providers like OpenAI, Anthropic, etc.). Each log entry contains:

**For each API call:**

- Which provider was used (OpenAI, Anthropic, etc.)
- Which model was called (GPT-4, Claude, etc.)
- Messages sent to the model
- Model's response
- Tokens used (input and output)
- Estimated cost in USD
- Timestamp of the call
- Success or failure status
- Any error messages

**Why this matters:**

- Troubleshoot AI responses
- Monitor token usage and costs
- Track API errors
- Audit AI interactions
- Understand conversation flow

## Accessing LLM Logs

**Go to Prospero** (`/foundry/prospero`) and expand the **LLM Logs** card.

The card shows:

- List of recent LLM logs (typically last 20 calls)
- Most recent logs at the top
- Quick overview of provider and model
- Timestamp of each call
- Status indicator (success/error)

## Understanding Log Information

### For Each Log Entry

**Provider**

- The AI service that was called
- Examples: OpenAI, Anthropic, Google, etc.
- Indicates which API was used

**Model**

- Specific model name used
- Examples: GPT-4, GPT-3.5-turbo, Claude-3-opus, etc.
- Different models have different capabilities and costs

**Timestamp**

- When the API call was made
- Shows date and time
- Helps identify when issues occurred

**Tokens Used**

- Input tokens: Tokens sent to the model
- Output tokens: Tokens in the model's response
- Displayed as "Input: X | Output: Y"

**Estimated Cost**

- Cost in USD for this single API call
- Based on provider's pricing
- Helps track expenses

**Status**

- **Success** - API call completed normally
- **Error** - API call failed
- **Partial** - Call succeeded but with warnings

### Viewing Detailed Logs

**Click on a log entry** to see full details:

- Complete prompt/messages sent to model
- Full response from model
- Token breakdown
- Error details (if failed)
- API response metadata
- Latency/timing information

**Details view allows:**

- Reading full conversation with model
- Understanding what model was asked
- Seeing exactly what model responded with
- Reviewing error messages
- Checking token counts

## Using Logs for Troubleshooting

### When AI Response Seems Wrong

1. **Open the LLM Logs**
2. **Find the relevant log entry** (by timestamp and topic)
3. **View full details**
4. **Check what was sent to model** - Was the prompt correct?
5. **Review model's response** - What exactly did it return?
6. **Identify the issue:**
   - Was prompt clear?
   - Did model misunderstand?
   - Was model constrained by token limit?
   - Did system prompt affect response?

### When API Calls Fail

1. **Look for failed logs** (red status)
2. **Click to view details**
3. **Read error message** from provider
4. **Common errors:**
   - **Rate limit exceeded:** Too many calls too fast
   - **Invalid API key:** Authentication failed
   - **Model not available:** Model is disabled or restricted
   - **Context too long:** Message exceeded token limit
   - **Network error:** Connection issue

### When Costs Are Higher Than Expected

1. **Check token counts** in logs
2. **Identify heavy-token-usage calls**
3. **Look for patterns** - What types of calls use most tokens?
4. **Review message history** - Long conversations use more tokens
5. **Consider switching to cheaper model** if high costs are an issue

## Monitoring Token Usage

### Understanding Tokens

**Tokens** are the basic units that AI models process:

- Roughly 4 characters = 1 token
- Large documents = many tokens
- Cost is charged per token

**Token usage breakdown:**

- **Input tokens:** What you send to the model (higher count = more cost)
- **Output tokens:** What model sends back (often more expensive per token)

**Estimating tokens:**

- 1 word ≈ 1.3 tokens
- 100 characters ≈ 25 tokens
- English text ≈ 1 token per 4 characters

### Tracking Costs

**Each log shows estimated cost:**

- Cost per API call
- Based on provider's token pricing
- Different models have different rates
- Add up costs to track total spending

**Tips for cost management:**

- Monitor which models use most tokens
- Consider using cheaper models for simple tasks
- Keep prompts concise
- Delete old chat histories to avoid reprocessing

## Log Retention & Storage

**How long logs are kept:**

- Recent logs stay in UI (usually 20-100 most recent)
- Older logs may be archived
- Contact admin for historical logs if needed

**Log storage:**

- Logs stored in your database
- Don't take up significant space
- Regularly cleaned up if space needed

## Filtering and Searching Logs

**If available in your UI, you can:**

- Filter by provider (show only OpenAI logs, etc.)
- Filter by model (show only GPT-4, etc.)
- Filter by date range
- Search by keywords
- Sort by token usage or cost
- Sort by timestamp

## Common Patterns in Logs

**Successful conversation:**

- Multiple logs with success status
- Increasing token counts (longer history)
- Consistent model usage
- Costs accumulate with each call

**Error pattern:**

- Failed logs grouped together
- Same error repeated
- Often rate limit or authentication errors
- May indicate API issue

**Model switching:**

- Different models used over time
- Cost variations between models
- Token efficiency differences
- Provider changes

## Privacy & Security

**What's in logs:**

- AI prompts and responses
- May contain user input data
- Chat message content
- System instructions

**Log security:**

- Logs are server-side (not exposed to client logs)
- Only accessible to you and admins
- Not transmitted elsewhere
- Encrypted in transit and at rest

**Viewing logs safely:**

- Only you can access your logs
- Support team can view with permission
- Logs are kept confidential
- You can request log deletion

## Troubleshooting

**Can't see my logs**

- Refresh the page
- Very recent calls may not appear immediately
- Old logs may be archived
- Contact support if missing logs

**Log seems incomplete**

- Some logs are truncated for display
- Click to view full details
- Very long responses may be shortened

**Wrong information in log**

- Logs record exactly what was sent/received
- Review original request
- Check if issue is with model response
- Contact support if data corruption suspected

**Cost tracking seems off**

- Verify token counts are accurate
- Check if multiple API calls were made
- Compare with provider's billing
- Contact support for cost verification

## Best Practices

**Regular Review:**

- Check logs periodically for patterns
- Monitor token usage trends
- Track cost over time
- Identify problematic queries

**Troubleshooting:**

- Always check logs when issues occur
- Full details help identify problems
- Share relevant logs with support
- Compare successful vs. failed patterns

**Cost Management:**

- Review high-cost calls regularly
- Identify which tasks use most tokens
- Consider model optimization
- Plan for capacity needs

**Monitoring:**

- Watch for error patterns
- Alert on rate limit errors
- Track model changes
- Document API changes

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [Connection Profiles](settings.md) - Configuring AI providers
- [Troubleshooting](help.md) - General troubleshooting guide
