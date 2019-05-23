import {Injectable} from '@angular/core';
import {select, Store} from '@ngrx/store';
import {initialMetricState,} from './store/metric.reducer';
import {AddMetric, DeleteMetric, LoadMetricState, UpdateMetric, UpsertMetric} from './store/metric.actions';
import {combineLatest, from, Observable} from 'rxjs';
import {LineChartData, Metric, MetricState, PieChartData, SimpleMetrics} from './metric.model';
import {PersistenceService} from '../../core/persistence/persistence.service';
import {getWorklogStr} from '../../util/get-work-log-str';
import {
  selectAllMetrics,
  selectImprovementCountsPieChartData,
  selectLastTrackedMetric,
  selectMetricById,
  selectMetricHasData,
  selectObstructionCountsPieChartData,
  selectProductivityHappinessLineChartData,
  selectProductivityHappinessLineChartDataComplete
} from './store/metric.selectors';
import {map, switchMap, take} from 'rxjs/operators';
import {TaskService} from '../tasks/task.service';
import {WorklogService} from '../worklog/worklog.service';
import {ProjectService} from '../project/project.service';
import {mapSimpleMetrics} from './metric.util';

@Injectable({
  providedIn: 'root',
})
export class MetricService {
  metrics$: Observable<Metric[]> = this._store$.pipe(select(selectAllMetrics));
  hasData$: Observable<boolean> = this._store$.pipe(select(selectMetricHasData));
  lastTrackedMetric$: Observable<Metric> = this._store$.pipe(select(selectLastTrackedMetric));
  improvementCountsPieChartData$: Observable<PieChartData> = this._store$.pipe(select(selectImprovementCountsPieChartData));
  obstructionCountsPieChartData$: Observable<PieChartData> = this._store$.pipe(select(selectObstructionCountsPieChartData));
  productivityHappinessLineChartData$: Observable<LineChartData> = this._store$.pipe(select(selectProductivityHappinessLineChartDataComplete));

  simpleMetrics$: Observable<SimpleMetrics> = this._projectService.currentId$.pipe(
    switchMap(() => {
      return combineLatest([
        this._worklogService.worklog$,
        this._worklogService.totalTimeSpent$,
        from(this._taskService.getAllTasks()),
      ]).pipe(
        map(mapSimpleMetrics),
      );
    }),
  );

  constructor(
    private _store$: Store<MetricState>,
    private _taskService: TaskService,
    private _projectService: ProjectService,
    private _worklogService: WorklogService,
    private _persistenceService: PersistenceService,
  ) {
  }

  async loadStateForProject(projectId: string) {
    const lsMetricState = await this._persistenceService.metric.load(projectId);
    this.loadState(lsMetricState || initialMetricState);
  }

  loadState(state: MetricState) {
    this._store$.dispatch(new LoadMetricState({state}));
  }

  getMetricById(id: string): Observable<Metric> {
    return this._store$.pipe(select(selectMetricById, {id}), take(1));
  }

  getTodaysMetric(): Observable<Metric> {
    const id = getWorklogStr();
    return this._store$.pipe(select(selectMetricById, {id}));
  }

  addMetric(metric: Metric) {
    this._store$.dispatch(new AddMetric({
      metric: {
        ...metric,
        id: metric.id || getWorklogStr(),
      }
    }));
  }

  deleteMetric(id: string) {
    this._store$.dispatch(new DeleteMetric({id}));
  }

  updateMetric(id: string, changes: Partial<Metric>) {
    this._store$.dispatch(new UpdateMetric({metric: {id, changes}}));
  }

  upsertMetric(metric: Metric) {
    this._store$.dispatch(new UpsertMetric({metric}));
  }

  // STATISTICS
  getProductivityHappinessChartData$(howMany = 20): Observable<LineChartData> {
    return this._store$.pipe(select(selectProductivityHappinessLineChartData, {howMany}));
  }


}
