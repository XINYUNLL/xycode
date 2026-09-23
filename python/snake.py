#!/usr/bin/env python3
"""终端贪吃蛇游戏 - 使用 curses 实现"""

import curses
import random
import time


def main(stdscr):
    # 初始化 curses
    curses.curs_set(0)  # 隐藏光标
    curses.start_color()
    curses.init_pair(1, curses.COLOR_GREEN, curses.COLOR_BLACK)   # 蛇身
    curses.init_pair(2, curses.COLOR_RED, curses.COLOR_BLACK)     # 食物
    curses.init_pair(3, curses.COLOR_YELLOW, curses.COLOR_BLACK)  # 分数
    curses.init_pair(4, curses.COLOR_CYAN, curses.COLOR_BLACK)    # 边框

    while True:
        result = game_loop(stdscr)
        if result == "quit":
            break


def game_loop(stdscr):
    stdscr.clear()
    stdscr.nodelay(True)
    stdscr.timeout(100)  # 100ms 刷新

    sh, sw = stdscr.getmaxyx()

    # 游戏区域（留出边框和分数栏）
    top, left = 2, 1
    height = sh - 3
    width = sw - 2

    if height < 10 or width < 20:
        stdscr.addstr(sh // 2, 0, "终端太小，请调整窗口大小！")
        stdscr.nodelay(False)
        stdscr.getch()
        return "quit"

    # 画边框
    for x in range(left, left + width):
        stdscr.addch(top, x, curses.ACS_HLINE, curses.color_pair(4))
        stdscr.addch(top + height - 1, x, curses.ACS_HLINE, curses.color_pair(4))
    for y in range(top, top + height):
        stdscr.addch(y, left, curses.ACS_VLINE, curses.color_pair(4))
        stdscr.addch(y, left + width - 1, curses.ACS_VLINE, curses.color_pair(4))
    stdscr.addch(top, left, curses.ACS_ULCORNER, curses.color_pair(4))
    stdscr.addch(top, left + width - 1, curses.ACS_URCORNER, curses.color_pair(4))
    stdscr.addch(top + height - 1, left, curses.ACS_LLCORNER, curses.color_pair(4))
    stdscr.addch(top + height - 1, left + width - 1, curses.ACS_LRCORNER, curses.color_pair(4))

    # 初始化蛇（游戏区域中心）
    cy, cx = top + height // 2, left + width // 2
    snake = [(cy, cx), (cy, cx - 1), (cy, cx - 2)]
    direction = curses.KEY_RIGHT

    # 生成第一个食物
    food = spawn_food(snake, top, left, height, width)

    score = 0
    speed = 100  # 初始速度（ms）

    while True:
        # 显示分数
        score_text = f" Score: {score} | Arrow keys to move | q to quit "
        stdscr.addstr(0, (sw - len(score_text)) // 2, score_text, curses.color_pair(3) | curses.A_BOLD)

        # 画食物
        stdscr.addch(food[0], food[1], "*", curses.color_pair(2) | curses.A_BOLD)

        # 画蛇
        for i, (y, x) in enumerate(snake):
            ch = "@" if i == 0 else "o"
            stdscr.addch(y, x, ch, curses.color_pair(1) | curses.A_BOLD)

        stdscr.refresh()

        # 获取输入
        key = stdscr.getch()

        if key == ord("q"):
            return "quit"

        # 防止反向移动
        opposites = {
            curses.KEY_UP: curses.KEY_DOWN,
            curses.KEY_DOWN: curses.KEY_UP,
            curses.KEY_LEFT: curses.KEY_RIGHT,
            curses.KEY_RIGHT: curses.KEY_LEFT,
        }
        if key in opposites and opposites[key] != direction:
            direction = key

        # 计算新头部位置
        head_y, head_x = snake[0]
        if direction == curses.KEY_UP:
            head_y -= 1
        elif direction == curses.KEY_DOWN:
            head_y += 1
        elif direction == curses.KEY_LEFT:
            head_x -= 1
        elif direction == curses.KEY_RIGHT:
            head_x += 1

        new_head = (head_y, head_x)

        # 碰撞检测：撞墙
        if (head_y <= top or head_y >= top + height - 1 or
                head_x <= left or head_x >= left + width - 1):
            return game_over(stdscr, score)

        # 碰撞检测：撞自身
        if new_head in snake:
            return game_over(stdscr, score)

        # 移动蛇
        snake.insert(0, new_head)

        # 吃食物
        if new_head == food:
            score += 10
            food = spawn_food(snake, top, left, height, width)
            # 加速（最快 50ms）
            speed = max(50, speed - 2)
            stdscr.timeout(speed)
        else:
            # 擦除尾巴
            tail = snake.pop()
            stdscr.addch(tail[0], tail[1], " ")


def spawn_food(snake, top, left, height, width):
    """在空白位置随机生成食物"""
    while True:
        y = random.randint(top + 1, top + height - 2)
        x = random.randint(left + 1, left + width - 2)
        if (y, x) not in snake:
            return (y, x)


def game_over(stdscr, score):
    """显示游戏结束画面"""
    sh, sw = stdscr.getmaxyx()
    stdscr.nodelay(False)

    messages = [
        "╔══════════════════════╗",
        "║     GAME  OVER!     ║",
        f"║   Score: {score:>6}      ║",
        "║                      ║",
        "║  r = Restart         ║",
        "║  q = Quit            ║",
        "╚══════════════════════╝",
    ]

    start_y = sh // 2 - len(messages) // 2
    for i, msg in enumerate(messages):
        x = (sw - len(msg)) // 2
        try:
            stdscr.addstr(start_y + i, x, msg, curses.color_pair(3) | curses.A_BOLD)
        except curses.error:
            pass

    stdscr.refresh()

    while True:
        key = stdscr.getch()
        if key == ord("r"):
            return "restart"
        elif key == ord("q"):
            return "quit"


if __name__ == "__main__":
    curses.wrapper(main)
