import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";

import { getPrimaryFrontendOrigin } from "../config/frontendOrigin.js";
import { getDatabasePool } from "../db/connection.js";
import { sendEmailVerificationEmail, sendPasswordResetEmail } from "../integrations/email.js";
import { ServiceError } from "./serviceError.js";

const tokenLifetime = "7d";
const tokenLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1000;

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new ServiceError(500, "JWT_SECRET is not configured on the server");
  }

  return process.env.JWT_SECRET;
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validateRegistration({ name, email, password }) {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw new ServiceError(400, "name must contain at least 2 characters");
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new ServiceError(400, "email must be valid");
  }

  if (typeof password !== "string" || password.length < 8) {
    throw new ServiceError(400, "password must contain at least 8 characters");
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

async function createSession(connection, user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + tokenLifetimeMilliseconds);

  await connection.execute(
    `INSERT INTO auth_sessions (id, user_id, expires_at)
     VALUES (?, ?, ?)`,
    [sessionId, user.id, expiresAt],
  );

  const token = jwt.sign(
    { sub: String(user.id), jti: sessionId },
    getJwtSecret(),
    { expiresIn: tokenLifetime },
  );

  return { token, expiresAt };
}

export async function registerUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  validateRegistration({ name, email: normalizedEmail, password });

  const passwordHash = await bcrypt.hash(password, 12);
  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [[existingUser]] = await connection.execute(
      "SELECT id FROM users WHERE email = ?",
      [normalizedEmail],
    );

    if (existingUser) {
      throw new ServiceError(409, "An account with this email already exists");
    }

    const [result] = await connection.execute(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, 'member', FALSE)`,
      [name.trim(), normalizedEmail, passwordHash],
    );

    const user = {
      id: result.insertId,
      name: name.trim(),
      email: normalizedEmail,
      role: "member",
    };
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await connection.execute(
      "INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))",
      [crypto.randomUUID(), user.id, tokenHash],
    );
    const frontendOrigin = getPrimaryFrontendOrigin();
    await sendEmailVerificationEmail({ email: user.email, name: user.name, verificationUrl: `${frontendOrigin}/verify-email?token=${token}` });
    await connection.commit();
    return user;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof password !== "string") {
    throw new ServiceError(400, "email and password are required");
  }
  getJwtSecret();

  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    const [[user]] = await connection.execute(
      `SELECT id, name, email, role, is_active AS isActive, password_hash AS passwordHash
       FROM users
       WHERE email = ?`,
      [normalizedEmail],
    );

    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new ServiceError(401, "Email or password is incorrect");
    }
    if (!user.isActive) {
      throw new ServiceError(403, "Please verify your email address before logging in.");
    }

    await connection.beginTransaction();
    const session = await createSession(connection, user);
    await connection.commit();

    return { user: publicUser(user), ...session };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function authenticateToken(token) {
  if (!token) {
    throw new ServiceError(401, "You must be logged in");
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch {
    throw new ServiceError(401, "Token is invalid or expired");
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || !payload.jti) {
    throw new ServiceError(401, "Token is invalid");
  }

  const pool = getDatabasePool();
  const [[session]] = await pool.execute(
    `SELECT user.id, user.name, user.email, user.role, user.is_active AS isActive, session.id AS sessionId
     FROM auth_sessions AS session
     JOIN users AS user ON user.id = session.user_id
     WHERE session.id = ?
       AND session.user_id = ?
       AND session.revoked_at IS NULL
       AND session.expires_at > NOW()`,
    [payload.jti, userId],
  );

  if (!session) {
    throw new ServiceError(401, "Your session is no longer active");
  }
  if (!session.isActive) {
    throw new ServiceError(403, "This account has been deactivated. Please contact the administrator.");
  }

  return { user: publicUser(session), sessionId: session.sessionId };
}

export async function logoutUser(sessionId) {
  const pool = getDatabasePool();
  await pool.execute(
    "UPDATE auth_sessions SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL",
    [sessionId],
  );
}

export async function verifyEmail({ token }) {
  if (typeof token !== "string" || !token.trim()) throw new ServiceError(400, "Verification token is required");
  const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
  const pool = getDatabasePool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[verification]] = await connection.execute(
      `SELECT id, user_id AS userId FROM email_verification_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`, [tokenHash],
    );
    if (!verification) throw new ServiceError(400, "This verification link is invalid or expired");
    await connection.execute("UPDATE users SET is_active = TRUE, email_verified_at = NOW() WHERE id = ?", [verification.userId]);
    await connection.execute("UPDATE email_verification_tokens SET used_at = NOW() WHERE id = ?", [verification.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
export async function createPasswordResetRequest({ email }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new ServiceError(400, "email must be valid");
  }

  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    const [[user]] = await connection.execute(
      "SELECT id, name, email FROM users WHERE email = ?",
      [normalizedEmail],
    );

    // Keep the same API response even when this email has no account.
    if (!user) return;

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await connection.beginTransaction();
    await connection.execute(
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL",
      [user.id],
    );
    await connection.execute(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), user.id, tokenHash, expiresAt],
    );
    await connection.commit();

    const frontendOrigin = getPrimaryFrontendOrigin();
    const resetUrl = `${frontendOrigin}/reset-password?token=${token}`;

    try {
      await sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetUrl,
      });
    } catch (error) {
      await connection.execute(
        "DELETE FROM password_reset_tokens WHERE token_hash = ?",
        [tokenHash],
      );
      throw error;
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function resetUserPassword({ token, newPassword }) {
  if (typeof token !== "string" || !token.trim()) {
    throw new ServiceError(400, "reset token is required");
  }

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new ServiceError(400, "newPassword must contain at least 8 characters");
  }

  const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
  const pool = getDatabasePool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [[resetToken]] = await connection.execute(
      `SELECT reset_token.id, reset_token.user_id AS userId,
              user.password_hash AS passwordHash
       FROM password_reset_tokens AS reset_token
       JOIN users AS user ON user.id = reset_token.user_id
       WHERE reset_token.token_hash = ?
         AND reset_token.used_at IS NULL
         AND reset_token.expires_at > NOW()
       FOR UPDATE`,
      [tokenHash],
    );

    if (!resetToken) {
      throw new ServiceError(400, "Reset link is invalid or has expired");
    }

    const [passwordHistory] = await connection.execute(
      "SELECT password_hash AS passwordHash FROM password_history WHERE user_id = ?",
      [resetToken.userId],
    );
    const usedPasswordHashes = [
      resetToken.passwordHash,
      ...passwordHistory.map((password) => password.passwordHash),
    ];
    const passwordWasUsedBefore = await Promise.all(
      usedPasswordHashes.map((passwordHash) => bcrypt.compare(newPassword, passwordHash)),
    );

    if (passwordWasUsedBefore.some(Boolean)) {
      throw new ServiceError(
        400,
        "Choose a password you have not used before",
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Preserve the current password before replacing it so it cannot be reused.
    await connection.execute(
      "INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)",
      [resetToken.userId, resetToken.passwordHash],
    );

    const [updateUserResult] = await connection.execute(
      `UPDATE users
       SET password_hash = ?,
           is_active = TRUE,
           email_verified_at = COALESCE(email_verified_at, NOW())
       WHERE id = ?`,
      [passwordHash, resetToken.userId],
    );
    if (updateUserResult.affectedRows !== 1) {
      throw new ServiceError(400, "Could not update this account");
    }

    await connection.execute(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?",
      [resetToken.id],
    );
    await connection.execute(
      "UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
      [resetToken.userId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
