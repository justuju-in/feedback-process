# Feedback Process

A team application for requesting, giving, receiving, and tracking feedback.

## Features

- Create, submit, acknowledge, close, cancel, or decline feedback requests
- Due dates, reminders, notifications, follow-up actions, and feedback history
- Email verification and password reset
- Search, filters, and private feedback visibility

## Requirements

- Node.js 20+
- MySQL 8+
- Git

## Setup

### 1. Clone and install

```bash
git clone <repository-url>
cd feedback-process
npm install
cd backend && npm install && cd ..
```

### 2. Create the database

```bash
mysql -u root -p < backend/scripts/schema.sql
mysql -u root -p feedback_process < backend/scripts/seed.sql
```

Replace `root` with your MySQL username if needed.

### 3. Add environment variables

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and add your MySQL details:

```env
PORT=5000
JWT_SECRET=replace_with_a_long_random_value
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=feedback_process
FRONTEND_ORIGIN=http://localhost:3000
```

For password-reset email, also add the `SMTP_*` and `EMAIL_FROM` values shown in `.env.example`.
Use a transactional mail provider or a Gmail App Password (not a normal Gmail password). `SMTP_SEND_ATTEMPTS`
and `SMTP_RETRY_DELAY_MS` retry short-lived SMTP/DNS failures automatically.

### 4. Run the project

Open two terminals.

```bash
# Terminal 1
cd backend
npm run dev
```

```bash
# Terminal 2, from the project root
npm run dev
```

Open <http://localhost:3000>.

### Sharing the app publicly

`localhost` only works on the computer running the app. To let other people register and log in,
deploy the Docker services to a public HTTPS host, then set `FRONTEND_ORIGIN` to that public URL,
set a strong unique `JWT_SECRET`, and configure a real SMTP mailbox. The included Docker ports are
intentionally bound to `127.0.0.1`; expose them through an HTTPS reverse proxy (for example Caddy or
Nginx) rather than directly exposing the database or API.

## Quick test

1. Create two user accounts and verify their emails.
2. Create a feedback request from one user to the other.
3. Submit the feedback as the selected giver.
4. Acknowledge and close it as the receiver.
5. Check Feedback History and notifications.

## Important

- Do not commit `backend/.env` or any passwords.
- If the app cannot connect, first check that MySQL and the backend at `http://localhost:5000/health` are running.
