# Postman Mocking Setup Guide for Kuala API

This guide explains how to set up a Postman mock server using the OpenAPI specification for the Kuala API.

## Prerequisites

- Postman Desktop App or Web App
- Access to the OpenAPI specification file (`spec/openapi.yml`)

## Step 1: Update OpenAPI Specification URLs

⚠️ **IMPORTANT**: Before importing the OpenAPI spec into Postman, you must update the placeholder URLs in the specification file.

### Required Changes in `spec/openapi.yml`

#### 1. Update Location Header Example (Line ~213)

Find this line in the `/auth/authorize` endpoint:

```yaml
example: "changethis/identity/realms/lebensraum/protocol/openid-connect/auth?client_id=eimunisasi..."
```

**Replace `changethis` with your API base URL:**

```yaml
example: "https://your-api-domain.com/identity/realms/lebensraum/protocol/openid-connect/auth?client_id=eimunisasi..."
```

#### 2. Update HTML Button Href (Line ~455)

Find this line in the `/identity/realms/{realms}/protocol/openid-connect/auth` endpoint:

```html
<a href="changethis/auth/v1/callback" class="auth-button"></a>
```

**Replace `changethis` with your frontend application URL:**

```html
<a href="https://your-frontend-app.com/auth/callback" class="auth-button"></a>
```

### Example Replacements

```yaml
# Before
example: "changethis/identity/realms/lebensraum/protocol/..."

# After (replace with your actual API domain)
example: "https://api.yourcompany.com/identity/realms/lebensraum/protocol/..."
example: "https://kuala-api-staging.seribasa.digital/identity/realms/lebensraum/protocol/..."
```

```html
<!-- Before -->
<a href="changethis/auth/v1/callback" class="auth-button">
  <!-- After (replace with your actual frontend domain) -->
  <a href="https://app.yourcompany.com/auth/callback" class="auth-button">
    <a href="https://yourapp.com/callback" class="auth-button"></a></a
></a>
```

### Quick Find & Replace

1. Open `spec/openapi.yml` in your text editor
2. Search for: `changethis`
3. Replace with appropriate URLs:
   - For API endpoints: Your API base URL (e.g., `https://api.yourcompany.com`)
   - For frontend callbacks: Your frontend URL (e.g., `https://app.yourcompany.com`)

## Step 2: Import OpenAPI Specification

### Method 1: Import from File

1. Open Postman
2. Click **"Import"** button in the top left
3. Select **"Upload Files"** tab
4. Choose the `spec/openapi.yml` file from your project
5. Click **"Import"**

### Method 2: Import from URL (if hosted)

1. Open Postman
2. Click **"Import"** button
3. Select **"Link"** tab
4. Paste the URL to your OpenAPI spec
5. Click **"Continue"** → **"Import"**

## Step 3: Review Imported Collection

After import, you should see:

- **Collection Name**: "Kuala API"
- **Folders organized by endpoint**:
  - Auth
  - Identity
  - Plans
  - Subscriptions
  - Invoices
  - Webhooks

## Step 4: Create Mock Server

1. **Right-click** on the "Kuala API" collection
2. Select **"Mock collection"**. If no, hover to more options and select **"Mock collection"**.
3. Configure mock server settings:
   - **Mock Server Name**: `Kuala API Mock`
   - **Environment**: Select or create new environment
   - **Make mock server private**: ✅ (recommended)
   - **Save responses from requests**: ✅ (optional)
4. Click **"Create Mock Server"**

## Step 4: Configure Mock Server

### Mock Server URL

After creation, you'll receive a mock server URL like:

```bash
https://[mock-id].mock.pstmn.io
```

### Environment Setup

1. Go to **"Environments"** in left sidebar
2. Create or edit your environment
3. Add variables:

   ```bash
   baseUrl: https://[your-mock-id].mock.pstmn.io
   bearerToken: mock-jwt-token-for-testing
   apikey: mock-supabase-anon-key
   ```

## Step 5: Test Mock Endpoints

### Example Requests to Test

#### 1. Get Plans

```http
GET {{baseUrl}}/plans?interval=month
```

## Step 6: Customize Mock Responses

### Adding Custom Examples

1. Open any request in the collection
2. Go to **"Examples"** tab
3. Click **"Add Example"**
4. Configure:
   - **Example Name**: Descriptive name
   - **Status Code**: 200, 400, 401, etc.
   - **Response Body**: JSON response
   - **Headers**: Content-Type, etc.

### Example Custom Response for `/plans`

```json
{
  "plans": [
    {
      "id": "free",
      "name": "Free Plan",
      "tier": "free",
      "features": [
        "Generic Apps",
        "Patient Appointment",
        "Clinic Virtual Assistant"
      ],
      "price": {
        "amount": 0,
        "currency": "USD",
        "interval": "month"
      },
      "selectable": true
    },
    {
      "id": "basic",
      "name": "Basic Plan",
      "tier": "basic",
      "features": [
        "Generic Apps",
        "Patient Appointment",
        "Clinic Virtual Assistant",
        "Published Apps",
        "Landing Page"
      ],
      "price": {
        "amount": 49.99,
        "currency": "USD",
        "interval": "month"
      },
      "selectable": true
    }
  ]
}
```

## Step 7: Advanced Mock Configuration

### Dynamic Responses

Use Postman's dynamic variables in examples:

```json
{
  "id": "{{$guid}}",
  "userId": "{{$guid}}",
  "createdAt": "{{$isoTimestamp}}",
  "amount": {{$randomInt}}
}
```

### Conditional Responses

Create multiple examples with different status codes:

- **200 Success**: Normal response
- **400 Bad Request**: Invalid parameters
- **401 Unauthorized**: Missing/invalid token
- **404 Not Found**: Resource not found

## Step 8: Share Mock Server

### Team Sharing

1. Go to **"Mock Servers"** in left sidebar
2. Find your mock server
3. Click **"Share"**
4. Configure sharing settings:
   - **Make public**: For external sharing
   - **Team access**: For internal team

### Documentation

1. Select your collection
2. Click **"View Documentation"**
3. Click **"Publish"** to create public docs
4. Include mock server URL in documentation

## Step 9: Integration with Frontend

### Using Mock in Development

Replace your API base URL with the mock server:

```javascript
// Development config
const API_BASE_URL = "https://[mock-id].mock.pstmn.io";

// Example API call
const response = await fetch(`${API_BASE_URL}/plans?interval=month`);
const data = await response.json();
```

### Environment Switching

```javascript
const config = {
  development: "https://[mock-id].mock.pstmn.io",
  staging: "https://kuala-api-staging.seribasa.digital",
  production: "https://kuala-api.seribasa.digital",
};
```

## Step 10: Validation and Testing

### Verify Mock Responses

1. Test all endpoints in Postman
2. Verify response structures match OpenAPI schema
3. Test different status codes
4. Validate authentication flows

### Common Issues and Solutions

#### Issue: 404 Not Found

- **Solution**: Ensure request path matches exactly
- Check for trailing slashes
- Verify HTTP method (GET, POST, etc.)

#### Issue: Missing Response Examples

- **Solution**: Add examples to requests
- Use OpenAPI examples as reference
- Create examples for different scenarios

#### Issue: Authentication Problems

- **Solution**: Configure proper Authorization headers
- Use environment variables for tokens
- Test with and without authentication

## Best Practices

1. **Keep Examples Updated**: Sync with actual API responses
2. **Use Realistic Data**: Generate meaningful test data
3. **Document Changes**: Update mock when API changes
4. **Version Control**: Include collection in Git repository
5. **Team Sync**: Share environment configurations

## Troubleshooting

### URLs Still Show "changethis"

**Problem**: Mock responses or examples still contain "changethis" placeholders  
**Solution**:

1. Ensure you updated the OpenAPI spec before importing
2. Re-import the collection after fixing URLs
3. Check examples in individual requests and update manually if needed

### Mock Server Not Responding

1. Check mock server status in Postman
2. Verify the mock URL is correct
3. Ensure proper request format

### Incorrect Responses

1. Review example configurations
2. Check status code matching
3. Verify request parameters

### CORS Issues

Mock servers handle CORS automatically, but ensure:

- Proper request headers
- Correct HTTP methods
- Valid origin domains

## Additional Resources

- [Postman Mock Server Documentation](https://learning.postman.com/docs/designing-and-developing-apis/mocking-data/setting-up-mock/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Postman Environment Variables](https://learning.postman.com/docs/sending-requests/managing-environments/)

---

## Quick Reference

### Mock Server URL Format

```bash
https://[mock-id].mock.pstmn.io/[endpoint]
```

### Required Headers for Auth Endpoints

```bash
Authorization: Bearer [token]
apikey: [supabase-anon-key]
Content-Type: application/json
```
