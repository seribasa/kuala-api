# Kuala Kill Bill Configuration

This directory contains the Docker Compose setup for running Kill Bill and related services.

## Prerequisites

- Docker and Docker Compose installed
- Bash shell for running initialization scripts

## Quick Start

1. **Copy the environment file:**

   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` file** (optional) to customize configuration:

   - Database credentials
   - Kill Bill admin credentials
   - Tenant API keys
   - Port mappings

3. **Start the services:**

   ```bash
   docker compose up -d
   ```

4. **Verify the services are running:**

   ```bash
   # Check service status
   docker compose ps

   # Check init container logs
   docker compose logs init-tenant
   docker compose logs init-catalog

   # Test Kill Bill API
   curl -u admin:password http://localhost:8080/1.0/healthcheck
   ```

## Services

### Kill Bill (`killbill`)

- **Port:** 8080 (configurable via `KILLBILL_PORT`)
- **API Endpoint:** <http://localhost:8080>
- **Healthcheck:** <http://localhost:8080/1.0/healthcheck>

### Kaui (`kaui`)

- **Port:** 9090 (configurable via `KAUI_PORT`)
- **UI:** <http://localhost:9090>
- Kill Bill admin interface

### MariaDB (`db`)

- **Port:** 3306 (internal)
- Database for Kill Bill and Kaui

### Init Tenant (`init-tenant`)

- One-time initialization container
- Creates the default tenant with API key/secret
- Runs automatically on first startup

### Init Catalog (`init-catalog`)

- One-time initialization container
- Uploads the plans catalog from `plans.xml`
- Runs after tenant creation

## Configuration

All configuration is managed through the `.env` file:

### Database Settings

```bash
MYSQL_ROOT_PASSWORD=killbill
KILLBILL_DAO_PASSWORD=killbill
```

### API Credentials

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=password
KILLBILL_API_KEY=demo
KILLBILL_API_SECRET=demosecret
```

### Ports

```bash
KILLBILL_PORT=8080
KAUI_PORT=9090
MYSQL_PORT=3306
```

## Shiro Authentication

The `shiro.ini` file is automatically generated from `shiro.ini.template` using environment variables:

```bash
# In .env file
ADMIN_USER=admin
ADMIN_PASSWORD=password
```

The admin credentials are dynamically injected at container startup, so you can easily change them by modifying the `.env` file without editing the Shiro configuration directly.

### Customizing Users

To change the admin credentials, simply update the `.env` file:

```bash
ADMIN_USER=myadmin
ADMIN_PASSWORD=mysecurepassword123
```

Then recreate the Kill Bill container:

```bash
docker compose down && docker compose up -d
```

To add additional users, edit `shiro.ini.template`:

```ini
[users]
${ADMIN_USER} = ${ADMIN_PASSWORD}, root
otheruser = otherpassword, root
```

**Note:** The template uses `${ADMIN_USER}` and `${ADMIN_PASSWORD}` which are replaced at runtime.

## Manual Scripts

If you need to run the initialization scripts manually:

### Create Tenant

```bash
./init-tenant.sh --api-key demo --api-secret demosecret
```

### Upload Catalog

```bash
./init-plans-catalog.sh --api-key demo --api-secret demosecret
```

You can override defaults by:

- Using command-line flags: `--admin-user <user> --admin-password <password>`
- Setting environment variables: `ADMIN_USER` and `ADMIN_PASSWORD`

## Troubleshooting

### Check logs

### Re-run init containers

```bash
# Remove and recreate init containers
docker compose rm -f init-tenant init-catalog
docker compose up -d init-tenant init-catalog
```

## Files

- **docker-compose.yaml** - Main Docker Compose configuration
- **.env** - Environment variables (not committed to git)
- **.env.example** - Template for environment variables
- **plans.xml** - Kill Bill catalog definition
- **shiro.ini.template** - Shiro security configuration template
- **generate-shiro.sh** - Script to generate shiro.ini from template
- **init-tenant.sh** - Script to create tenant
- **init-plans-catalog.sh** - Script to upload catalog

## Security Notes

⚠️ **Important:** Change the default password in `shiro.ini` before deploying to production!

For production deployments:

1. Use strong, unique passwords
2. Consider using environment variables or secrets management
3. Limit user permissions based on the principle of least privilege
4. Regularly rotate credentials

## References

- [Kill Bill Documentation](https://docs.killbill.io/latest/)
- [Kill Bill API Reference](https://killbill.github.io/slate/)
- [Kill Bill User Management](https://docs.killbill.io/latest/user_management)
- [Apache Shiro Documentation](https://shiro.apache.org/documentation.html)
