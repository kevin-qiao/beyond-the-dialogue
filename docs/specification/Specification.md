# Background
* This project is a personal project and the delivery will be a desktop application
* The purpose is user could use this application to handle daily works better by leveraging AI
* This idea is inspired by 'MS To Do' application which I use everyday; I use **To Do** application to manage my daily work and to-do tasks, but I think AI features could be integrated into it to make the to-do tasks management better

# Features

## To-do list
* User could add any pending tasks into the application, and manage all of them as to-do tasks
* User could configure the alarm of the task for timed notification
* Besides the task title, user could add more information about the task:
	* Task background
	* Task target
	* Additional information: file, link or anything
* Manage the different tasks with different categories

## Built-in Agent
* There is a built-in agent into this application, it means this application is built upon an agent harness
	* Agent harness can support skills and MCPs
	* Agent harness can call necessary tools
* Through the agent harness, this application can connect to the LLM service

## AI Assistant
* It is possible to trigger AI assist for each task
* There are different types of task which needs different kinds of AI assist
	* **Document:**
		* Sometimes, you want to write some blogs, articals, diary or others, you just need to write in this application, and the written content will be well-organized by AI and save into the path with [LLM-wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) support; meanwhile based on the task background and your content, you can ask AI anytime, and AI can give you more insights according to your context
		* Sometimes, you want to recording some learning note for something, and if you configure the original materials for this task, then you can put any thought or any inspired raw text in this application, and this application will leverage AI to re-organize your note and make it better format then manage them in the path with LLM-wiki support; meanwhile you can ask AI anytimes about your learning content, AI can give helpful suggestions according to your context
		* More cases are possible rather than the above 2 cases
	* **Working system:**
		* JIRA: If you need to handle several JIRA tasks, you could put the JIRA into this application, then AI can read the JIRA information and help you accordingly 
		* Confluence: if you need to review some confluence pages, you just need to paste confluence page link for the task, then AI will read the corresponding page and give you any review comments; from this application, you can leave your review comments to confluence directly
		* More system integration rather than the above 2 cases
	* **Coding:**
		* Usually you will use the dedicated coding agent for implementing the code
		* But if you set some to-do tasks in this application with your github link, and by the end of the day, AI could analyze your PRs and your progress and reocord your daily progress automatically
		* In some day, you want to review your development progress and any insights, you can easily find them from this application

## Advanced features
* **Memory**
	* Through the daily usage, this application can remember the user habits for specific types
	* With the memory, AI could guess the user's preference more accurately and give more helpful suggestions to users
* **Customized type**
	* Since different user has different requirements, it is needed to provide the customized types for user
	* If it is able to support customized UX for specific customized type, it will be more helpful

# Version plan

| Version | Features                                                                 | Remark |
| ------- | ------------------------------------------------------------------------ | ------ |
| v1.0    | To-do list <br/> Built-in agent harness <br/> Document type AI assistant |        |
| v2.0    | Coding type AI assistant                                                 |        |
| v3.0    | Working system type integration                                          |        |
| v4.0    | TBD                                                                      |        |
