---
url: /salon/:id
---

# Random Number Generator (RNG) Tool

The RNG tool lets you roll dice, flip coins, or randomly select a chat participant. Results appear as permanent messages in the chat, visible to all characters.

## How to Use

### Auto-Detection (Default)

By default, Quilltap automatically detects RNG patterns in both your messages and character responses, executing them automatically. Just type naturally:

- "I roll 2d6 for damage" → Quilltap automatically rolls 2d6
- "Let's flip a coin" → Quilltap flips a coin
- "Spin the bottle to see who goes next" → Quilltap randomly selects a participant

**Works on character responses too!** When a character says something like:

- *"I roll a d20 to see if I succeed"* → The d20 is actually rolled
- *"Let me flip a coin to decide"* → A real coin flip happens
- *"20d2"* → Even creative dice notations are detected and rolled

**Detected patterns:**

- **Dice notation**: `d6`, `2d20`, `3d10`, etc. (1-100 dice, 2-1000 sides)
- **Coin flips**: "flip a coin" (with up to 3 characters between "flip" and "coin")
- **Spin the bottle**: "spin the bottle", "spin a bottle"

For your messages, results appear as tool messages before your message. For character responses, results appear as tool messages after the response. Either way, everyone in the chat sees the outcome.

**Note:** This feature can be disabled in [Chat Settings](/settings?tab=chat) under "Automation" if you prefer to use the manual tool palette or want to discuss dice without executing rolls.

### From the Tool Palette

1. Open the **Tool Palette** in a chat (the toolbar button)
2. Click the **RNG** dropdown
3. Choose a quick option or create a custom roll:
   - **Roll d6** - Roll a six-sided die
   - **Roll d20** - Roll a twenty-sided die
   - **Roll 2d6** - Roll two six-sided dice
   - **Flip Coin** - Get heads or tails
   - **Spin the Bottle** - Randomly select a chat participant
   - **Custom Roll** - Choose any number of sides (2-1000) and rolls (1-100)

### Via AI Tool Use

The AI can also roll dice and flip coins when asked. Just tell the character what you want:

- "Roll a d20 for me"
- "Flip a coin"
- "Who should go next? Spin the bottle!"
- "Roll 4d6 for character stats"

The AI will use the RNG tool and the result will appear in the chat.

## Result Types

### Dice Rolls

Roll any die from 2 to 1000 sides:

- **Single roll**: "Rolled a d20: **17**"
- **Multiple rolls**: "Rolled 3d6: [4, 2, 6] = **12** total"

Common dice:

- d4 (4-sided)
- d6 (6-sided)
- d8 (8-sided)
- d10 (10-sided)
- d12 (12-sided)
- d20 (20-sided)
- d100 (percentile)

### Coin Flips

Get a random heads or tails result:

- **Single flip**: "Coin flip result: **heads**"
- **Multiple flips**: "Flipped 3 coins: [heads, tails, heads] (2 heads, 1 tails)"

### Spin the Bottle

Randomly select from all active chat participants (both AI characters and user personas):

- **Single spin**: "The bottle points to: **Alice**"
- **Multiple spins**: "Spun the bottle 3 times: [Alice, Bob, Alice]"

This includes:

- All active AI characters
- User personas
- Any impersonated characters

## Technical Details

### Security

The RNG uses cryptographically secure random numbers (Node.js `crypto.randomBytes`), ensuring fair and unpredictable results.

### Limits

- **Dice sides**: 2 to 1,000
- **Number of rolls**: 1 to 100

### Permanent Results

RNG results are saved as tool messages in the chat history. They:

- Remain visible when you return to the chat
- Are included in chat exports
- Are visible to all characters in multi-character chats

## Use Cases

### Tabletop Gaming

- Roll dice for RPG checks and combat
- Determine initiative order
- Generate random encounters

### Roleplay

- Make character decisions based on chance
- Determine random events
- Select which character speaks next

### Games and Fun

- Flip coins for yes/no decisions
- Play simple games with characters
- Add randomness to story elements

## Related Topics

- [Tools](tools.md) - Overview of all Quilltap tools
- [Using Tools in Chat](tools-usage.md) - How tools work during conversations
- [Chat Participants](chat-participants.md) - Managing characters in chats
