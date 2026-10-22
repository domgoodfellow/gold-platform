/** Compatibility adapter; retirement criteria are in docs/data.md. */
export {listTasks as listFollowUps,createTask as createFollowUp,updateTask as updateFollowUp,changeTaskStatus as changeFollowUpStatus,type CrmTask as FollowUp,type TaskKind as FollowUpKind,type TaskStatus as FollowUpStatus,type TaskInput as FollowUpInput,type TaskFilter as FollowUpFilter} from '../tasks/tasks';
