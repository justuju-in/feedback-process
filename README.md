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

## Quick test

1. Create two user accounts and verify their emails.
2. Create a feedback request from one user to the other.
3. Submit the feedback as the selected giver.
4. Acknowledge and close it as the receiver.
5. Check Feedback History and notifications.

## Important

- Do not commit `backend/.env` or any passwords.
- If the app cannot connect, first check that MySQL and the backend at `http://localhost:5000/health` are running.

## Formbricks custom templates

In Request feedback, choose Create custom template, then Formbricks custom form.
Save the form before continuing. Simple text questions and existing template
management remain available. Formbricks forms are private to their creator and
can be answered by the selected feedback giver. Create a new form version to
change questions without changing past responses. Give feedback continues to
use the existing text templates.

For deployed form creation, configure the backend's FORMBRICKS_URL,
FORMBRICKS_API_KEY, and FORMBRICKS_WORKSPACE_ID. Credentials stay on the server.
Without a workspace, development mode supports local test forms; production
returns a configuration error instead. Startup creates the two additional
Formbricks tables without replacing existing tables.

Run the form conversion checks with `node --test backend/tests/formbricks.test.js backend/tests/formbricksBuilder.test.js`.
