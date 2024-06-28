
import { Typography } from "@material-tailwind/react";
import PropTypes from 'prop-types'; // ES6

const SectionTittle = ({title}) => {
  return (
    <div className="pt-24 mb-14">
      <Typography
        variant="h3"
        className="text-[#3DBDEC] text-3xl md:text-5xl lg:text-6xl text-center"
      >
        {title}
      </Typography>
    </div>
  );
}

SectionTittle.propTypes = {
  title: PropTypes.string,
};


export default SectionTittle