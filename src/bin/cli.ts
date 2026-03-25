#!/usr/bin/env node
console.log(`[DEBUG] CLI Start: cwd=${process.cwd()}`);
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { version } from '../../package.json';
import { startAction } from './commands/start';
import { doctorAction } from './commands/doctor';
import { setupAction } from './commands/setup';
import { openAction } from './commands/open';
import { ConfigLoader } from '../utils/configLoader';
import { printWelcome } from './welcome';

const program = new Command()
    .name('antigravity-telegram-remote')
    .description('Điều khiển trợ lý lập trình AI của bạn từ Telegram')
    .version(version)
    .option('--verbose', 'Hiển thị nhật ký cấp độ debug')
    .option('--quiet', 'Chỉ hiển thị lỗi');

// Default action: no subcommand → start or setup
program.action(async () => {
    const hasConfig = ConfigLoader.configExists();
    const hasEnv = fs.existsSync(path.resolve(process.cwd(), '.env'));

    if (!hasConfig && !hasEnv) {
        printWelcome();
        return setupAction();
    } else {
        return startAction(program.opts(), program);
    }
});

program
    .command('start')
    .description('Bắt đầu bot Telegram')
    .action((_opts, cmd) => startAction(cmd.parent.opts(), cmd.parent));

program
    .command('doctor')
    .description('Kiểm tra môi trường và các phụ thuộc')
    .action(doctorAction);

program
    .command('setup')
    .description('Trình hướng dẫn thiết lập tương tác')
    .action(setupAction);

program
    .command('open')
    .description('Mở Antigravity với CDP được bật (tự động chọn cổng khả dụng)')
    .action(openAction);

program.parse();
