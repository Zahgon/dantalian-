#!/usr/bin/env node
import { run } from '../src/main.js';

await run(process.argv.slice(2));
