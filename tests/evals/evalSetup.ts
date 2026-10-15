import * as fs from 'fs'
import * as path from 'path'

/**
 * Marks the run's start (the report merges only case files written after it) and, unless
 * re-scoring the saved answers, clears the previous run's case files.
 */
export default function evalSetup() {
  const dir = process.env.EVAL_OUT || path.join(__dirname, 'results')
  fs.mkdirSync(dir, { recursive: true })
  if (process.env.EVAL_RESCORE !== '1') {
    for (const f of fs.readdirSync(dir)) if (/^case-.+\.json$/.test(f)) fs.rmSync(path.join(dir, f))
  }
  fs.writeFileSync(path.join(dir, '.run-start'), String(Date.now()))
}
