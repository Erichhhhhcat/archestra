# Database Backup & Restore

## Create Backup

```bash
kubectl exec -n archestra archestra-platform-postgresql-0 -- env PGPASSWORD=archestra_dev_password pg_dump -U archestra archestra_dev > db_dump_$(date +%Y%m%d_%H%M%S).sql
```

## Restore Backup

```bash
kubectl exec -i -n archestra archestra-platform-postgresql-0 -- env PGPASSWORD=archestra_dev_password psql -U archestra archestra_dev < db_dump_YYYYMMDD_HHMMSS.sql
```

## Clean Restore (Drop & Recreate Database)

```bash
# Terminate active connections and drop database (single exec to prevent reconnects)
kubectl exec -n archestra archestra-platform-postgresql-0 -- env PGPASSWORD=archestra_dev_password psql -U archestra -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'archestra_dev' AND pid <> pg_backend_pid();" -c "DROP DATABASE archestra_dev;"

# Create fresh database
kubectl exec -n archestra archestra-platform-postgresql-0 -- env PGPASSWORD=archestra_dev_password psql -U archestra -d postgres -c "CREATE DATABASE archestra_dev;"

# Restore from backup
kubectl exec -i -n archestra archestra-platform-postgresql-0 -- env PGPASSWORD=archestra_dev_password psql -U archestra archestra_dev < db_dump_YYYYMMDD_HHMMSS.sql
```
