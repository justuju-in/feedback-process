const unavailableMessage = "Login service is unavailable. Please check the backend and database connection.";

export async function readLoginResponse(response) {
  // Proxies can return plain text or HTML when the backend cannot be reached.
  if (response.status >= 500) throw new Error(unavailableMessage);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The login service returned an unexpected response. Please check the backend connection.");
  }
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : null;
    throw new Error(message || (response.status === 401 ? "Email or password is incorrect" : "Could not log in"));
  }
  if (!data?.user?.id) throw new Error("The login service returned an incomplete response. Please try again.");
  return data;
}
