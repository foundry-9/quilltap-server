# Capabilities Report

> **[Open this page in Quilltap](/tools)**

The Capabilities Report tool generates detailed documentation of your Quilltap system's configuration, installed providers, and capabilities.

## What's in a Capabilities Report?

A capabilities report includes:

**System Information**

- Quilltap version
- Installation type
- System configuration
- Database information

**AI Providers**

- Installed LLM providers (OpenAI, Anthropic, etc.)
- Configured models per provider
- Provider settings and capabilities
- API access status

**Image Generation**

- Installed image providers
- Available models
- Configuration details
- API status

**Connection Profiles**

- All configured connection profiles
- Provider details for each profile
- Web search settings
- API key configuration (without exposing keys)

**Character Configurations**

- Installed character types
- Persona profiles
- Memory settings
- Template configurations

**Plugins**

- Installed plugin tools
- Plugin versions
- Tool definitions
- Configuration status

**File Management**

- Storage backend (local, S3, etc.)
- Storage capacity
- File type support
- Upload settings

**System Capabilities**

- Features available
- Limitations or restrictions
- Performance metrics
- Integration points

## Generating a Report

**Step-by-Step:**

1. **Go to the Tools page** (`/tools`)

2. **Find the Capabilities Report card**

3. **Click "Generate Report"** button

4. **System generates report**
   - May take several minutes
   - Shows progress
   - Collects configuration data

5. **Report saved**
   - Appears in report list
   - Shows creation date and file size
   - Ready to view or download

**Report generation includes:**

- Scanning all installed providers
- Checking all configurations
- Testing API connections
- Gathering system statistics

## Viewing Reports

**View a report in the app:**

1. Find the report in the list
2. Click **View** or **Open**
3. Report displays in a modal or new view
4. Shows formatted report content

**Information displayed:**

- Full provider configurations
- Model details and capabilities
- Connection status indicators
- Resource usage and limits

## Downloading Reports

**Download report to your computer:**

1. **Find the report** in the Capabilities Report list

2. **Click the Download button**
   - Downloads as a text file (.txt) or PDF
   - File name includes date generated

3. **Saved to your downloads folder**
   - Store for reference or sharing
   - Can share with support team

**Why download:**

- Share with technical support
- Archive for documentation
- Compare with previous reports
- Detailed offline reference

## Managing Reports

**List of reports shows:**

- Report filename
- Date generated
- File size
- Actions (view, download, delete)

**Actions available:**

**View** - Open report in the application
**Download** - Save report to your computer
**Delete** - Remove report (to save space)

## Using Reports for Troubleshooting

**When having issues:**

1. **Generate a new report**
   - Captures current state
   - Documents all configurations

2. **Share with support**
   - Helps support team understand your setup
   - Speeds up troubleshooting
   - No sensitive data exposed (API keys hidden)

3. **Compare reports**
   - Generate before and after changes
   - Identify what changed
   - Verify configurations

**Report helps troubleshoot:**

- API connection issues
- Missing providers or models
- Configuration errors
- Capability limitations
- Integration problems

## Common Report Uses

**Documenting Setup**

- Create report of working configuration
- Reference for future setup
- Audit trail of capabilities

**Before System Changes**

- Generate report before updates
- Compare after update
- Identify what changed

**Performance Tuning**

- See resource usage
- Identify bottlenecks
- Plan optimizations

**Sharing Configuration**

- Share with team members
- Provide to support (without API keys)
- Document for compliance

**Planning Upgrades**

- See what providers you have
- Understand capacity
- Plan model additions

## Report Contents Explained

**Provider Section**

- Lists each AI provider you've configured
- Shows which models are available
- Indicates if provider is properly connected
- Shows API key status (not the actual key)

**Model Details**

- Model names and versions
- Input/output capabilities
- Context window sizes
- Performance characteristics

**Configuration Status**

- Checkmarks for working configurations
- Warnings for potential issues
- Suggestions for optimization

**Connection Tests**

- Shows which connections work
- Indicates any connection failures
- Helps identify network issues

## Privacy & Security

**Report security:**

- Reports don't contain actual API keys
- Sensitive credentials are masked
- Safe to share with support
- Can be sent via email

**What's NOT in reports:**

- Your actual API keys
- User data or chat contents
- Personal information
- Login credentials

**What IS in reports:**

- Configuration structure
- Available models and capabilities
- System status and health
- Error messages and diagnostics

## Troubleshooting Report Generation

**Report generation failed**

- Check system resources available
- Try again after stopping other tasks
- Large systems take longer
- Contact support if repeatedly fails

**Report takes too long**

- Large systems with many providers take time
- Don't cancel unless stuck
- System is collecting all configuration data
- Normal to take 5-10 minutes

**Can't view report**

- Refresh page
- Try downloading instead
- Check browser compatibility
- Contact support if view fails

**Report looks incomplete**

- All information collected should be present
- Some sections may be empty if not configured
- Generate new report if needed
- Contact support for missing sections

## Best Practices

**Regular Generation:**

- Generate monthly or quarterly
- Keeps documented setup current
- Track configuration changes
- Audit trail for compliance

**Before Support Contact:**

- Generate recent report
- Share with support team
- Speeds up issue resolution
- Provides diagnostic context

**Archive Reports:**

- Keep historical reports
- Documents system evolution
- Comparison reference
- Compliance documentation

**Share Safely:**

- Reports are safe to share
- API keys are not exposed
- Good for team documentation
- Can send to external support

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [Connection Profiles](settings.md) - Configuring providers
- [Plugins](plugins.md) - Installing and managing plugins
