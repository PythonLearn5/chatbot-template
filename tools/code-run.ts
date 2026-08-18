import { tool } from "ai"
import { z } from "zod"
import { execFile } from "child_process"
import { writeFile, mkdir, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"

export const codeRun = tool({
  description:
    "Execute Python code in a sandboxed environment. Use this when the user asks to run, execute, or test code. The code should be a complete Python script. Supports standard library only (no pip install). Timeout: 10 seconds.",
  inputSchema: z.object({
    language: z
      .enum(["python", "javascript"])
      .default("python")
      .describe("Programming language to execute"),
    code: z.string().describe("The code to execute. Should be a complete script."),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    success: z.boolean(),
  }),
  execute: async ({ language, code }) => {
    const sessionId = randomUUID()
    const workDir = join(tmpdir(), `mcp-code-${sessionId}`)
    await mkdir(workDir, { recursive: true })

    const ext = language === "python" ? ".py" : ".js"
    const filename = `script${ext}`
    const filepath = join(workDir, filename)

    await writeFile(filepath, code, "utf-8")

    const cmd = language === "python" ? "python" : "node"
    const args = [filepath]

    return new Promise((resolve) => {
      execFile(
        cmd,
        args,
        {
        cwd: workDir,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PYTHONPATH: workDir,
          NODE_PATH: workDir,
        },
      },
        async (error, stdout, stderr) => {
          // 清理临时文件
          try {
            await rm(workDir, { recursive: true, force: true })
          } catch {
            // ignore
          }

          if (error && error.killed) {
            resolve({
              stdout: stdout?.toString() ?? "",
              stderr: "执行超时（10 秒限制）",
              exitCode: -1,
              success: false,
            })
            return
          }

          const exitCode = error ? (error.code as number) ?? 1 : 0
          resolve({
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
            exitCode,
            success: !error,
          })
        }
      )
    })
  },
})
