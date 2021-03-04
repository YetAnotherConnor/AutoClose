## A plugin for [Dragory's ModMail](https://github.com/dragory/modmailbot) that automatically closes inactive threads

## Setup
In your config.ini file, add:
```
plugins[] = npm:YetAnotherConnor/AutoClose
```
and after you restart your bot, AutoClose should activate!
On first startup AutoClose will not recognize the current threads, although sending any message will register that thread.

## Useage
### Extra Configuration
Threads without any interaction will close after 24 hours, a first warning at 6 hours, and a final warning at 30 minutes by default.
You can change these defaults by adding to your config.ini file with any of the following:
- `autoClose-closeHours` the number of hours of inactivity in a thread to trigger an auto-close
- `autoClose-warnHours` the number of hours remaining until auto-close as a first warning
- `autoClose-warnMinutes` the number of minutes remaining until auto-close as the second warning

### Information
This plugin requires the `AutoCloseData.json` file which is created on first launch; moving or deleting this file will not break this plugin, but data will be lost.

If you run multiple instances of the bot from the same folder, you can set an `autoClose-suffix` in your config.ini file which will differentiate other `AutoCloseData[suffix].json` files.

## Commands

Parameters in <> are required, parameters in [] optional. These commands can only be used within a modmail thread.
### Stopping AutoClose from Closing a Thread
Useage: `!ac stop`
- AutoClose will not close the thread this command is sent in until `!ac start` is sent

### Restarting AutoClose
Useage: `!ac start`
- This command will restart AutoClose for the thread this command is sent in

### Checking Remaining Time
Useage: `!ac`
- The bot will reply with either that the thread is currently stopped, or the reamaining time left until close
