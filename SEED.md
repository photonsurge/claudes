

Add SESSION_SECRET= to the repo-root .env (e.g. openssl rand -hex 32), same as the existing JWT_SECRET/SOCKET_TOKEN_SECRET entries.
Run the seed script with the email/password you want:

cd worker && ADMIN_EMAIL=rich@photonsurge.uk ADMIN_PASSWORD=planet9$ yarn seed:admin



Log in at /login with those credentials. From there you can add more admins via /admin/users.
