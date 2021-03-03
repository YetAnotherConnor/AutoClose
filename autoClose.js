module.exports = async function ({ bot, commands, config, threads, knex }) {
  const fs = require("fs");
  let autoCloseThreads = [];

  const MINUTES = 60 * 1000;
  const HOURS = 60 * MINUTES;

  const closeHours = config["autoClose-choseHours"] ? config["autoClose-choseHours"] * HOURS : 24 * HOURS;
  const warnHours = config["autoClose-warnHours"] ? config["autoClose-warnHours"] * HOURS : 6 * HOURS;
  const warnMinutes = config["autoClose-warnMinutes"] ? config["autoClose-warnMinutes"] * MINUTES : 30 * MINUTES;

  //load the suffix for the json file, if one exists (for mutilpe modmail instances)
  const jsonSuffix = config["autoClose-suffix"] ? config["autoClose-suffix"] : "";

  //warn the user not to delete the file in case on first time creation
  if (!fs.existsSync(`./AutoCloseData${jsonSuffix}.json`)) {
    console.info(
      `[AutoClose] An AutoCloseData${jsonSuffix}.json file will be created when using this plugin. Please do not modify or delete this file.`,
    );
  } else {
    //load registered threads if the file exists
    const data = fs.readFileSync(`./AutoCloseData${jsonSuffix}.json`);
    autoCloseThreads = JSON.parse(data);
    console.info(`[AutoClose] Successfully loaded ${autoCloseThreads.length} thread(s)`);
    console.info(
      `[AutoClose] Threads close at ${closeHours} hours with warns at ${warnHours} hours and at ${warnMinutes} minutes`,
    );
  }

  //stores all registered threads into the data file for persistence
  const saveACData = function () {
    fs.writeFileSync(`./AutoCloseData${jsonSuffix}.json`, JSON.stringify(autoCloseThreads));
  };

  /**
   * update or add entry based off the channelId
   * @param {String} channelId ID of given channel
   * @param {String} warnStatus status of entry
   *    0: less than closeHours remaining (default)
   *    1: less than warnHours remaining
   *    2: less than warnMinutes remaining
   *    3: thread stopped
   * @param {Number} closeAt epoch timestamp to close at
   * @param {Boolean} resetMsg true to send the reset message
   * @returns full entry
   */
  async function updateEntry(channelId, warnStatus, closeAt = null, resetMsg = false) {
    for (autoCloseThread of autoCloseThreads) {
      if (autoCloseThread.channelId == channelId) {
        if (autoCloseThread.warnStatus == "3") return;
        if (resetMsg && autoCloseThread.warnStatus !== "0") {
          const userThread = await threads.findOpenThreadByChannelId(channelId);
          userThread.postSystemMessage(`:gear: **AutoClose:** Reset AutoClose for this thread`);
        }
        //update existing entry
        autoCloseThread.warnStatus = warnStatus;
        autoCloseThread.closeAt = closeAt == null ? autoCloseThread.closeAt : closeAt;
        saveACData();
        return autoCloseThread;
      }
    }
    //add new entry
    const entry = {
      channelId: channelId,
      warnStatus: warnStatus == null ? "0" : warnStatus,
      closeAt: closeAt == null ? Date.now() + closeHours : closeAt,
    };
    autoCloseThreads.push(entry);
    saveACData();
    return entry;
  }

  /**
   * removes the index of the thread object in autoCloseThreads
   * @param {Object} removedThread
   */
  function remove(removedThread) {
    for (i = 0; i < autoCloseThreads.length; i++) {
      if (autoCloseThreads[i].channelId == removedThread.channelId) {
        autoCloseThreads.splice(i, 1);
        saveACData();
      }
    }
  }

  async function checkThreadsToAutoClose() {
    //loop through autoCloseThreads and check if closeAt < now
    //also check for warn status and warn messages
    for (autoCloseThread of autoCloseThreads) {
      if (autoCloseThread.warnStatus == "3") continue;
      //auto close suspended
      else if (autoCloseThread.closeAt < Date.now()) {
        //close the thread and delete entry
        const userThread = await threads.findOpenThreadByChannelId(autoCloseThread.channelId);
        if (!userThread) {
          //thread was closed or removed outside of this plugin, removing entry
          remove(autoCloseThread);
          continue;
        }

        //date & time as YYYY-MM-DD hh:mm:ss format:
        const dateNow = new Date(autoCloseThread.closeAt);
        const year = dateNow.getFullYear();
        const month = ("0" + (dateNow.getMonth() + 1)).slice(-2);
        const date = ("0" + dateNow.getDate()).slice(-2);
        const hours = ("0" + dateNow.getHours()).slice(-2);
        const minutes = ("0" + dateNow.getMinutes()).slice(-2);
        const seconds = ("0" + dateNow.getSeconds()).slice(-2);
        const time = year + "-" + month + "-" + date + " " + hours + ":" + minutes + ":" + seconds;

        //by updating threads table at scheduled_close _at and _name, close.js takes care of closing
        await knex("threads").where("id", userThread.id).update({
          scheduled_close_at: time,
          scheduled_close_id: bot.user.id, //just for reference
          scheduled_close_name: "**AutoClose**",
        });

        remove(autoCloseThread);
      } else if (autoCloseThread.closeAt < Date.now() + warnMinutes && autoCloseThread.warnStatus < 2) {
        //warning stage 2, 30 minute warning by default
        const userThread = await threads.findOpenThreadByChannelId(autoCloseThread.channelId);
        if (!userThread) {
          //thread was closed or removed outside of this plugin, removing entry
          remove(autoCloseThread);
          continue;
        }

        userThread.postSystemMessage(
          `:gear: **AutoClose:** This thread will close in ${warnMinutes / MINUTES} minutes`,
        );
        updateEntry(autoCloseThread.channelId, "2");
      } else if (autoCloseThread.closeAt < Date.now() + warnHours && autoCloseThread.warnStatus < 1) {
        //warning stage 1, 6 hour warning by default
        const userThread = await threads.findOpenThreadByChannelId(autoCloseThread.channelId);
        if (!userThread) {
          //thread was closed or removed outside of this plugin, removing entry
          remove(autoCloseThread);
          continue;
        }

        userThread.postSystemMessage(`:gear: **AutoClose:** This thread will close in ${warnHours / HOURS} hours`);
        updateEntry(autoCloseThread.channelId, "1");
      }
    }
  }

  // Check initially then every minute afterwards
  checkThreadsToAutoClose();
  setInterval(checkThreadsToAutoClose, 1 * MINUTES);

  /**
   * each time a message is sent in a thread,
   * autoClose will reset closeAt, warnStatus if needed
   */
  bot.on("messageCreate", async (message) => {
    if (message.guildID !== config.inboxServerId) return;

    //check if message was from AutoClose
    //note: ALL messages from AutoClose must start with this string (naive approach)
    if (message.content.startsWith(":gear: **AutoClose:**")) return;
    //check if closing the thread
    if (message.content.startsWith("Closing thread...")) return;
    //ignore AutoClose commands
    if (message.content.startsWith(`${config.prefix}ac`)) return;

    const userThread = await threads.findOpenThreadByChannelId(message.channel.id);
    if (!userThread) return;

    updateEntry(message.channel.id, "0", Date.now() + closeHours, true);
  });

  /**
   * send user status of thread and update if requested
   * @param {*} msg the message which invoked the command
   * @param {*} args the argument passed, "command"
   */
  const acCmd = async (message, args) => {
    const userThread = await threads.findOpenThreadByChannelId(message.channel.id);
    if (!args.command) {
      for (autoCloseThread of autoCloseThreads) {
        if (autoCloseThread.channelId == message.channel.id) {
          if (autoCloseThread.warnStatus == "3") {
            userThread.postSystemMessage(`:gear: **AutoClose:** This thread is currently stopped`);
          } else {
            const milisecondsLeft = autoCloseThread.closeAt - Date.now();
            const hoursLeft = Math.floor(milisecondsLeft / HOURS);
            const minutesLeft = Math.floor((milisecondsLeft - hoursLeft * HOURS) / MINUTES);
            const closeTime = `${hoursLeft == 0 ? `` : hoursLeft + ` hours`}${
              hoursLeft != 0 && minutesLeft != 0 ? ` and ` : ``
            }${minutesLeft == 0 ? `` : minutesLeft + ` minutes`}`;
            userThread.postSystemMessage(`:gear: **AutoClose:** This thread will close in ${closeTime}`);
          }
        }
      }
    } else if (args.command == "start") {
      for (autoCloseThread of autoCloseThreads) {
        if (autoCloseThread.channelId == userThread.channel_id) {
          autoCloseThread.warnStatus = "0";
          autoCloseThread.closeAt = Date.now() + closeHours;
          saveACData();
        }
      }
      userThread.postSystemMessage(`:gear: **AutoClose:** Restarted AutoClose for this thread`);
    } else if (args.command == "stop") {
      updateEntry(userThread.channel_id, "3");
      userThread.postSystemMessage(`:gear: **AutoClose:** Stopped AutoClose for this thread`);
    }
  };

  commands.addInboxThreadCommand("ac", [{ name: "command", type: "string", required: false }], acCmd);
};
