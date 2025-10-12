# Kuala Kill Bill Configuration

This directory contains the Shiro configuration file for customizing Kill Bill authentication.

## Configuration

The `shiro.ini` file defines users and their roles for Kill Bill authentication.

### Default Credentials

- **Username:** `admin`
- **Password:** `password`
- **Role:** `root` (has all permissions: `*:*`)

### Customizing Users

Edit `shiro.ini` to add or modify users:

```ini
[users]
# Format: username = password, role1, role2, ...
admin = password, root
newuser = newpassword, root

[roles]
root = *:*
```

### Docker Setup

The `docker-compose.yaml` file is configured to:

1. Mount `shiro.ini` into the Kill Bill container at `/var/lib/killbill/shiro.ini`
2. Set the environment variable `KILLBILL_SECURITY_SHIRO_RESOURCE_PATH=file:/var/lib/killbill/shiro.ini`

This configuration is automatically applied when you run:

```bash
./init-tenant.sh --start-stack --api-key demo --api-secret demosecret
```

### Scripts

There are two main scripts that interact with Kill Bill:

- `init-tenant.sh`: Initializes a new tenant in Kill Bill. For usage details, run:

  ```bash
    ./init-tenant.sh --help
  ```

- `init-plans-catalog.sh`: Uploads a plans catalog to Kill Bill. For usage details, run:

  ```bash
    ./init-plans-catalog.sh --help
  ```

The following scripts now use the custom credentials by default:

- `init-tenant.sh` - Uses `admin:password` for tenant creation
- `init-plans-catalog.sh` - Uses `admin:password` for catalog upload

You can override these defaults by:

- Using command-line flags: `--admin-user <user> --admin-password <password>`
- Setting environment variables: `ADMIN_USER` and `ADMIN_PASSWORD`

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
