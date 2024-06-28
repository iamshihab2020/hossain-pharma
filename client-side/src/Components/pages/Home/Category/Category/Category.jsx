import SectionTittle from "../../../Shared/SectionTittle/SectionTittle";
import CategoryCard from "../CategoryCard/CategoryCard";
// import useSeeAllCategory from "../../../../hooks/useSeeAllCategory";
import useCategory from "../../../../hooks/useCategory";

const Category = () => {
  const {categories} = useCategory();

  return (
    <div>
      <SectionTittle title={"Category"} />
      <div className="flex item-center justify-around flex-wrap lg:px-20">
        {categories.map((item) => (
          <div className="pb-14" key={item._id}>
            <CategoryCard item={item} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default Category;
