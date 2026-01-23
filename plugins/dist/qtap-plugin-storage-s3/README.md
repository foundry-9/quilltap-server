# S3 File Storage Plugin for Quilltap

Amazon S3 and S3-compatible file storage backend plugin for Quilltap.

## Features

- **Full S3 Support**: Works with Amazon S3 and S3-compatible services
- **S3-Compatible Services**: Supports MinIO, DigitalOcean Spaces, Wasabi, Backblaze B2, and more
- **Presigned URLs**: Generate temporary, time-limited URLs for direct file access
- **Public URLs**: Support for public/CDN URLs when using custom endpoints
- **Streaming Operations**: Efficient streaming uploads and downloads
- **Server-Side Copy**: Copy files within S3 without downloading/re-uploading
- **File Metadata**: Retrieve file size, content type, and modification times
- **IAM Role Support**: Use AWS IAM roles without storing credentials
- **Path Prefixes**: Organize files with optional path prefixes
- **Multiple Regions**: Support for AWS regions and custom S3 endpoints

## Installation

This plugin is built into Quilltap and can be installed from the plugins marketplace or by cloning the repository.

```bash
npm install qtap-plugin-storage-s3
```

## Configuration

### Amazon S3

```json
{
  "bucket": "my-quilltap-bucket",
  "region": "us-east-1",
  "accessKey": "AKIAIOSFODNN7EXAMPLE",
  "secretKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
}
```

For AWS IAM role authentication, leave `accessKey` and `secretKey` empty.

### MinIO (Local Development)

```json
{
  "bucket": "quilltap",
  "region": "us-east-1",
  "endpoint": "http://localhost:9000",
  "accessKey": "minioadmin",
  "secretKey": "minioadmin",
  "forcePathStyle": true,
  "pathPrefix": "files"
}
```

### DigitalOcean Spaces

```json
{
  "bucket": "my-space",
  "region": "nyc3",
  "endpoint": "https://nyc3.digitaloceanspaces.com",
  "accessKey": "DO_SPACES_KEY",
  "secretKey": "DO_SPACES_SECRET",
  "pathPrefix": "quilltap"
}
```

### Wasabi

```json
{
  "bucket": "my-bucket",
  "region": "us-east-1",
  "endpoint": "https://s3.wasabisys.com",
  "accessKey": "WASABI_KEY",
  "secretKey": "WASABI_SECRET",
  "pathPrefix": "quilltap"
}
```

## Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `bucket` | string | ✓ | - | S3 bucket name |
| `region` | string | | us-east-1 | AWS region or service region |
| `endpoint` | string | | - | Custom endpoint URL for S3-compatible services |
| `accessKey` | secret | | - | Access key ID (leave empty for IAM role auth) |
| `secretKey` | secret | | - | Secret access key |
| `pathPrefix` | string | | - | Optional prefix for all object keys |
| `forcePathStyle` | boolean | | false | Use path-style URLs (required for MinIO/Minio) |
| `publicUrl` | string | | - | Custom public URL or CDN distribution URL |

## Development

### Building the plugin

```bash
npm install
npm run build
```

This will bundle the plugin into `index.js` using esbuild.

### Dependencies

- `@aws-sdk/client-s3` - AWS S3 client
- `@aws-sdk/s3-request-presigner` - Presigned URL generation

## Capabilities

The S3 backend supports the following capabilities:

- ✓ Presigned URLs for temporary access
- ✓ Public URLs for permanent access
- ✓ Streaming uploads
- ✓ Streaming downloads
- ✓ Server-side copy operations
- ✓ File listing with prefix matching
- ✓ File metadata retrieval

## Environment Variables

The plugin respects standard AWS SDK environment variables:

- `AWS_ACCESS_KEY_ID` - AWS access key (used if not in config)
- `AWS_SECRET_ACCESS_KEY` - AWS secret key (used if not in config)
- `AWS_REGION` - Default region (used if not in config)

## Troubleshooting

### Connection Test Failed

If the connection test fails:
1. Verify the bucket name is correct
2. Check that credentials have permissions to list bucket contents
3. For custom endpoints, ensure the URL is correct and accessible
4. Check security groups/firewall rules for connectivity

### Path Traversal Prevention

The plugin normalizes all paths to prevent directory traversal attacks:
- Paths starting with `..` are rejected
- Paths are validated against the configured bucket

### IAM Role Authentication

When using AWS IAM roles (credentials left empty):
- The SDK will look for credentials in environment variables
- Or use credentials from EC2 instance metadata
- Or load from `~/.aws/credentials`

## License

MIT

## Contributing

This is a core plugin for Quilltap. Contributions are welcome via the main Quilltap repository.
