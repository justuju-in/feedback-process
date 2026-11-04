# Feedback Process API

Base URL while running locally: `http://localhost:5000`

## Authentication APIs

Before using these APIs, set a long random `JWT_SECRET` in `backend/.env`.

Database prerequisite (owned by Pooja): the `users` table needs a `password_hash` column and an `auth_sessions` table. The API code expects those database changes but does not create them.

### Register

`POST /auth/register`

```json
{
  "name": "New User",
  "email": "new.user@example.com",
  "password": "minimum-8-characters"
}
```

### Login

`POST /auth/login`

```json
{
  "email": "new.user@example.com",
  "password": "minimum-8-characters"
}
```

Register and login return a `token` and public user information. Rani's frontend should send that token in this header for protected routes:

```text
Authorization: Bearer <token>
```

### Current logged-in user

`GET /auth/me`

Requires the Bearer token header.

### Logout

`POST /auth/logout`

Requires the Bearer token header. The server revokes that session, so the token cannot be used again.

## Routes built by the API owner

### Check the server

`GET /health`

Response:

```json
{
  "ok": true,
  "message": "Feedback Process API is running"
}
```

### List users

`GET /users`

Returns Rani, Shanti, and Pooja.

### List feedback templates

`GET /templates`

Returns the template ID and name. It does not return questions, so the frontend can request them only when needed.

### Get questions for one template

`GET /templates/:id/questions`

Example: `GET /templates/1/questions`

Returns a `404` response when the template does not exist.

## How to run and test

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

For the local MySQL user used by `.env.example`, run this once:

```sql
CREATE USER IF NOT EXISTS 'feedback_user'@'localhost' IDENTIFIED BY 'feedback123';
GRANT ALL PRIVILEGES ON feedback_process.* TO 'feedback_user'@'localhost';
FLUSH PRIVILEGES;
```

Open these URLs in the browser or send `GET` requests in Postman:

```text
http://localhost:5000/health
http://localhost:5000/users
http://localhost:5000/templates
http://localhost:5000/templates/1/questions
```

## Feedback request APIs

### Create a request

`POST /feedback-requests`

```json
{
  "requesterId": 1,
  "giverId": 2,
  "templateId": 1,
  "message": "Please share feedback about my learning.",
  "dueDate": "2026-08-15"
}
```

`dueDate` is optional. When provided, it must be a valid `YYYY-MM-DD` date that is not in the past.

### Get requests received by a feedback giver

`GET /feedback-requests/giver/:userId`

Example: `GET /feedback-requests/giver/2`

### Get requests sent by a requester

`GET /feedback-requests/requester/:userId`

Example: `GET /feedback-requests/requester/1`

### Get one request

`GET /feedback-requests/:id`

### Submit answers

`POST /feedback-requests/:id/answers`

```json
{
  "giverId": 2,
  "answers": [
    "You learned Express routing well.",
    "Practice API validation more.",
    "Build one small project using the same topic."
  ]
}
```

### Perform a request lifecycle action

`POST /feedback-requests/:id/actions`

```json
{
  "actorId": 1,
  "action": "acknowledge"
}
```

Allowed actions and rules:

- `decline`: only the feedback giver can decline a `requested` request.
- `cancel`: only the requester can cancel a `requested` request.
- `acknowledge`: only the requester can acknowledge a `submitted` request.
- `close`: only the requester can close an `acknowledged` request.
