import { configStore } from "@/service/config";
import { verifyToken } from "@/service/gistService";

const TOKEN_PROMPT_MESSAGE =
  "Create a GitHub Personal Access Token (classic) with the `gist` scope, then paste it here:";

export async function runLogin() {
  const { default: inquirer } = await import("inquirer");
  const { token } = await inquirer.prompt<{ token: string }>([
    {
      type: "password",
      name: "token",
      message: TOKEN_PROMPT_MESSAGE,
      mask: "*",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Please enter a token.",
    },
  ]);

  const trimmedToken = token.trim();

  try {
    await verifyToken(trimmedToken);
    await configStore.setToken(trimmedToken);
    console.log("Login successful: token has been saved.");
  } catch (error) {
    console.error(
      [
        "Login failed: token is invalid or cannot access the Gist API.",
        "Please create a GitHub Personal Access Token (classic) with the `gist` scope and try again.",
      ].join("\n")
    );
    throw error;
  }
}
