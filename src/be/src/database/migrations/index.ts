import { CreateUnit1759400000000 } from './1759400000000-CreateUnit.js';
import { CreateAccountAndSession1759500000000 } from './1759500000000-CreateAccountAndSession.js';
import { CreateAccountRole1759600000000 } from './1759600000000-CreateAccountRole.js';
import { CreateAuditLog1759700000000 } from './1759700000000-CreateAuditLog.js';
import { CreateOrganization1759800000000 } from './1759800000000-CreateOrganization.js';
import { CreateCatalog1759900000000 } from './1759900000000-CreateCatalog.js';
import { CreateEvaluation1760000000000 } from './1760000000000-CreateEvaluation.js';
import { CreateTasking1760100000000 } from './1760100000000-CreateTasking.js';
import { EvaluationTaskSource1760200000000 } from './1760200000000-EvaluationTaskSource.js';
import { EvaluationLeadership1760300000000 } from './1760300000000-EvaluationLeadership.js';
import { CreateWorkTask1760400000000 } from './1760400000000-CreateWorkTask.js';
import { EvaluationTaskTitles1760500000000 } from './1760500000000-EvaluationTaskTitles.js';
import { CreateCatalogTask1760600000000 } from './1760600000000-CreateCatalogTask.js';
import { CatalogVersionName1760700000000 } from './1760700000000-CatalogVersionName.js';
import { CatalogGroupExtensible1760800000000 } from './1760800000000-CatalogGroupExtensible.js';
import { CreateCatalogItemScope1760900000000 } from './1760900000000-CreateCatalogItemScope.js';
import { ProgressMajorError1761000000000 } from './1761000000000-ProgressMajorError.js';
import { PositionIsLeader1761100000000 } from './1761100000000-PositionIsLeader.js';
import { PersonProfile1761200000000 } from './1761200000000-PersonProfile.js';
import { CreateDocuments1761400000000 } from './1761400000000-CreateDocuments.js';
import { CreateNotifications1761500000000 } from './1761500000000-CreateNotifications.js';
import { TaskCollaboration1761300000000 } from './1761300000000-TaskCollaboration.js';

/** Danh sách migration theo thứ tự. Thêm migration mới vào cuối mảng. */
export const migrations = [
  CreateUnit1759400000000,
  CreateAccountAndSession1759500000000,
  CreateAccountRole1759600000000,
  CreateAuditLog1759700000000,
  CreateOrganization1759800000000,
  CreateCatalog1759900000000,
  CreateEvaluation1760000000000,
  CreateTasking1760100000000,
  EvaluationTaskSource1760200000000,
  EvaluationLeadership1760300000000,
  CreateWorkTask1760400000000,
  EvaluationTaskTitles1760500000000,
  CreateCatalogTask1760600000000,
  CatalogVersionName1760700000000,
  CatalogGroupExtensible1760800000000,
  CreateCatalogItemScope1760900000000,
  ProgressMajorError1761000000000,
  PositionIsLeader1761100000000,
  PersonProfile1761200000000,
  TaskCollaboration1761300000000,
  CreateDocuments1761400000000,
  CreateNotifications1761500000000,
];
