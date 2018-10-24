import { createEntityAdapter, EntityAdapter, EntityState } from '@ngrx/entity';
import { TaskActions, TaskActionTypes } from './task.actions';
import { Task, TimeSpentOnDay } from '../task.model';
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { calcTotalTimeSpent } from '../util/calc-total-time-spent';
import { selectIssueEntityMap } from '../../issue/issue.selector';
import { tasks } from 'googleapis/build/src/apis/tasks';

export const TASK_FEATURE_NAME = 'tasks';

export interface TaskState extends EntityState<Task> {
  // additional entities state properties
  currentTaskId: string | null;

  // NOTE: but it is not needed currently
  todaysTaskIds: string[];
  backlogTaskIds: string[];

  // TODO though this not so much maybe
  // todayDoneTasks: string[];
  // todayUnDoneTasks: string[];
}

export const taskAdapter: EntityAdapter<Task> = createEntityAdapter<Task>();

const mapIssueDataToTask = (tasks_, issueEntityMap) => {
  return tasks_ && tasks_.map((task) => {
    const issueData = (task.issueId && task.issueType) && issueEntityMap[task.issueType][task.issueId];
    return issueData ? {...task, issueData: issueData} : task;
  });
};

const mapSubTasksToTasks = (tasks__) => {
  return tasks__.filter((task) => !task.parentId)
    .map((task) => {
      if (task.subTaskIds && task.subTaskIds.length > 0) {
        return {
          ...task,
          subTasks: task.subTaskIds
            .map((subTaskId) => tasks__.find((task_) => task_.id === subTaskId))
        };
      } else {
        return task;
      }
    });
};

const mapTasksFromIds = (tasks__, ids) => {
  return ids.map(id => tasks__.find(task => task.id === id));
};

// SELECTORS
// ---------
const {selectIds, selectEntities, selectAll, selectTotal} = taskAdapter.getSelectors();
export const selectTaskFeatureState = createFeatureSelector<TaskState>(TASK_FEATURE_NAME);
export const selectBacklogTaskIds = createSelector(selectTaskFeatureState, state => state.backlogTaskIds);
export const selectTodaysTaskIds = createSelector(selectTaskFeatureState, state => state.todaysTaskIds);
export const selectCurrentTask = createSelector(selectTaskFeatureState, state => state.currentTaskId);


export const selectAllTasks = createSelector(selectTaskFeatureState, selectAll);
export const selectAllTasksWithIssueData = createSelector(selectAllTasks, selectIssueEntityMap, mapIssueDataToTask);

export const selectAllTasksWithSubTasks = createSelector(selectAllTasksWithIssueData, mapSubTasksToTasks);

export const selectTodaysTasksWithSubTasks = createSelector(selectAllTasksWithSubTasks, selectTodaysTaskIds, mapTasksFromIds);

export const selectBacklogTasksWithSubTasks = createSelector(selectAllTasksWithSubTasks, selectBacklogTaskIds, mapTasksFromIds);


// REDUCER
// -------
export const initialTaskState: TaskState = taskAdapter.getInitialState({
  currentTaskId: null,
  todaysTaskIds: [],
  backlogTaskIds: [],
});

const moveTaskInArray = (arr_, taskId, targetId) => {
  if (arr_.indexOf(taskId) > -1) {
    const arr = arr_.splice(0);
    arr.splice(arr.indexOf(taskId), 1);
    const targetIndex = targetId ? arr.indexOf(targetId) : 0;
    arr.splice(targetIndex, 0, taskId);
    return arr;
  } else {
    return arr_;
  }
};

const addTimeSpentToTask = (task: Task, timeSpent: number, date: string): TimeSpentOnDay => {
  const currentTimeSpentForTickDay = task.timeSpentOnDay && +task.timeSpentOnDay[date] || 0;
  return {
    ...task.timeSpentOnDay,
    [date]: (currentTimeSpentForTickDay + timeSpent)
  };
};

const updateTimeSpentForParent = (task: Task, state: TaskState): TaskState => {
  const parentId = task.parentId;
  if (parentId) {
    const parentTask = {...state.entities[parentId]};
    const subTasks = parentTask.subTaskIds.map((id) => state.entities[id]);
    const timeSpentOnDayParent = {};
    subTasks.forEach((subTask) => {
      console.log(subTask);

      Object.keys(subTask.timeSpentOnDay).forEach(strDate => {
        if (subTask.timeSpentOnDay[strDate]) {
          if (!timeSpentOnDayParent[strDate]) {
            timeSpentOnDayParent[strDate] = 0;
          }
          timeSpentOnDayParent[strDate] += subTask.timeSpentOnDay[strDate];
        }
      });
    });
    return taskAdapter.updateOne({
      id: task.parentId,
      changes: {
        timeSpentOnDay: timeSpentOnDayParent,
        timeSpent: calcTotalTimeSpent(timeSpentOnDayParent),
      }
    }, state);
  } else {
    return state;
  }
};

export function taskReducer(
  state = initialTaskState,
  action: TaskActions
): TaskState {
  // console.log(state.entities, state, action);

  switch (action.type) {
    // Meta Actions
    // ------------
    case TaskActionTypes.LoadState: {
      return {...action.payload.state};
    }

    case TaskActionTypes.SetCurrentTask: {
      return {...state, currentTaskId: action.payload};
    }

    case TaskActionTypes.UnsetCurrentTask: {
      return {...state, currentTaskId: null};
    }

    // Task Actions
    // ------------
    // TODO maybe merge with AddTask
    case TaskActionTypes.AddTaskWithIssue: {
      return {
        ...taskAdapter.addOne(action.payload.task, state),
        ...(
          action.payload.isAddToBacklog ? {
            backlogTaskIds: [action.payload.task.id, ...state.backlogTaskIds]
          } : {
            todaysTaskIds: [action.payload.task.id, ...state.todaysTaskIds]
          }
        ),
      };
    }

    case TaskActionTypes.AddTask: {
      return {
        ...taskAdapter.addOne(action.payload.task, state),
        ...(
          action.payload.isAddToBacklog ? {
            backlogTaskIds: [action.payload.task.id, ...state.backlogTaskIds]
          } : {
            todaysTaskIds: [action.payload.task.id, ...state.todaysTaskIds]
          }
        ),
      };
    }

    case TaskActionTypes.UpdateTask: {
      return taskAdapter.updateOne(action.payload.task, state);
    }

    case TaskActionTypes.UpdateTasks: {
      return taskAdapter.updateMany(action.payload.tasks, state);
    }

    // TODO also delete related issue :(
    case TaskActionTypes.DeleteTask: {
      const taskToDelete = state.entities[action.payload.id];
      // delete entry
      let stateCopy = taskAdapter.removeOne(action.payload.id, state);
      let currentTaskId = (state.currentTaskId === action.payload.id) ? null : state.currentTaskId;

      // also delete from parent task if any
      if (taskToDelete.parentId) {
        stateCopy = taskAdapter.updateOne({
          id: taskToDelete.parentId,
          changes: {
            subTaskIds: stateCopy.entities[taskToDelete.parentId].subTaskIds
              .filter((id) => id !== action.payload.id),
          }
        }, stateCopy);
        // also update time spent for parent
        stateCopy = updateTimeSpentForParent(taskToDelete, stateCopy);
      }

      // also delete all sub tasks if any
      if (taskToDelete.subTaskIds) {
        stateCopy = taskAdapter.removeMany(taskToDelete.subTaskIds, stateCopy);
        // unset current if one of them is the current task
        currentTaskId = taskToDelete.subTaskIds.includes(currentTaskId) ? null : currentTaskId;
      }

      return {
        ...stateCopy,
        // finally delete from backlog or todays tasks
        backlogTaskIds: state.backlogTaskIds.filter((id) => id !== action.payload.id),
        todaysTaskIds: state.todaysTaskIds.filter((id) => id !== action.payload.id),
        currentTaskId
      };
    }

    case TaskActionTypes.LoadTasks: {
      return taskAdapter.addAll(action.payload.tasks, state);
    }

    case TaskActionTypes.ClearTasks: {
      return taskAdapter.removeAll(state);
    }

    case TaskActionTypes.MoveAfter: {
      const taskId = action.payload.taskId;
      const targetId = action.payload.targetItemId;
      // TODO handle sub task case
      return {
        ...state,
        ids: moveTaskInArray(state.ids, taskId, targetId),
        backlogTaskIds: moveTaskInArray(state.backlogTaskIds, taskId, targetId),
        todaysTaskIds: moveTaskInArray(state.todaysTaskIds, taskId, targetId),
      };
    }

    case TaskActionTypes.AddTimeSpent: {
      let stateCopy;
      const taskToUpdate = state.entities[action.payload.taskId];
      const updateTimeSpentOnDay = addTimeSpentToTask(taskToUpdate, action.payload.tick.duration, action.payload.tick.date);
      stateCopy = taskAdapter.updateOne({
        id: action.payload.taskId,
        changes: {
          timeSpentOnDay: updateTimeSpentOnDay,
          timeSpent: calcTotalTimeSpent(updateTimeSpentOnDay)
        }
      }, state);

      // also update time spent for parent
      stateCopy = updateTimeSpentForParent(taskToUpdate, stateCopy);

      return stateCopy;
    }

    // case TaskActionTypes.UpdateTimeSpent: {
    //   const stateCopy = {
    //     ...taskAdapter.updateOne({
    //       id: action.payload.taskId,
    //       changes: {
    //         timeSpentOnDay: action.payload.timeSpentOnDay,
    //         timeSpent: calcTotalTimeSpent(action.payload.timeSpentOnDay)
    //       }
    //     }, state)
    //   };
    //
    //   // TODO update parent
    //   const parentId = currentTask.parentId;
    //   if (parentId) {
    //     const subTasksArray = stateCopy.entities[parentId].subTaskIds;
    //     subTasksArray.splice(subTasksArray.indexOf(action.payload.id), 1);
    //   }
    //   return stateCopy;
    // }

    case TaskActionTypes.AddSubTask: {
      // add item1
      const stateCopy = taskAdapter.addOne({
        ...action.payload.task,
        parentId: action.payload.parentId
      }, state);

      // also add to parent task
      const parentTask = stateCopy.entities[action.payload.parentId];
      parentTask.subTaskIds.push(action.payload.task.id);
      return stateCopy;
    }

    default: {
      return state;
    }
  }
}
